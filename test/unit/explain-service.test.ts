import { describe, expect, it, vi } from 'vitest';
import { ExplainService, type ExplainDeps } from '../../src/core/ai/explain-service';
import { ProviderError, type ExplainRequest, type Provider } from '../../src/core/ai/types';
import type { ExplainServerMsg } from '../../src/core/messaging/types';
import { DEFAULT_SETTINGS } from '../../src/core/storage/settings';

const req: ExplainRequest = {
  media: {},
  transcriptHash: 'h',
  transcript: [{ id: 1, text: 'Hi.' }],
  target: { cueId: 1 },
  prev: [],
  next: [],
  level: 'B1',
  outLang: 'ru',
  mode: 'short',
  onlyPast: false,
};

function provider(gen: (signal: AbortSignal) => AsyncGenerator<string>): Provider {
  return { id: 'gemini', explain: (_r, s) => gen(s), listModels: async () => [] };
}

function deps(p: Provider | (() => Promise<Provider>), over: Partial<ExplainDeps> = {}): ExplainDeps {
  return {
    loadSettings: async () => structuredClone(DEFAULT_SETTINGS),
    loadSecrets: async () => ({ geminiKey: 'k' }),
    createProvider: typeof p === 'function' ? p : async () => p,
    getCached: vi.fn().mockResolvedValue(null),
    putCached: vi.fn().mockResolvedValue(undefined),
    firstTokenMs: 15_000,
    retry: { retries: 2, baseDelayMs: 1, maxWaitMs: 20_000 },
    ...over,
  };
}

async function run(svc: ExplainService, id = 1, force = false) {
  const msgs: ExplainServerMsg[] = [];
  await svc.run(id, req, force, (m) => msgs.push(m));
  return msgs;
}

describe('ExplainService', () => {
  it('streams visible text, stores the complete answer and reports done', async () => {
    const d = deps(
      provider(async function* () {
        yield 'Это ';
        yield 'приветствие.\n@@TY';
        yield 'PE: literal\n@@CONFIDENCE: high';
      }),
    );
    const msgs = await run(new ExplainService(d));
    expect(msgs.map((m) => m.type)).toEqual(['meta', 'chunk', 'chunk', 'done']);
    expect(
      msgs
        .filter((m) => m.type === 'chunk')
        .map((m) => (m as { text: string }).text)
        .join(''),
    ).toBe('Это приветствие.\n');
    const done = msgs.at(-1) as Extract<ExplainServerMsg, { type: 'done' }>;
    expect(done.result).toEqual({ text: 'Это приветствие.', type: 'literal', confidence: 'high' });
    expect(d.putCached).toHaveBeenCalledWith(
      done.cacheKey,
      done.result,
      DEFAULT_SETTINGS.gemini.model,
      20 * 1024 * 1024,
    );
  });

  it('answers from cache without touching the provider (FR-K2)', async () => {
    const create = vi.fn();
    const d = deps(create, {
      getCached: vi.fn().mockResolvedValue({ text: 'cached', type: 'idiom', confidence: 'low', model: 'm' }),
    });
    const t0 = performance.now();
    const msgs = await run(new ExplainService(d));
    expect(performance.now() - t0).toBeLessThan(100);
    expect(create).not.toHaveBeenCalled();
    expect(msgs[0]).toMatchObject({ type: 'meta', cached: true });
    expect(msgs.at(-1)).toMatchObject({ type: 'done', result: { text: 'cached', type: 'idiom' } });
  });

  it('bypasses the cache on refresh', async () => {
    const getCached = vi
      .fn()
      .mockResolvedValue({ text: 'old', type: 'other', confidence: 'medium', model: 'm' });
    const d = deps(
      provider(async function* () {
        yield 'new';
      }),
      { getCached },
    );
    const msgs = await run(new ExplainService(d), 1, true);
    expect(getCached).not.toHaveBeenCalled();
    expect(msgs.at(-1)).toMatchObject({ type: 'done', result: { text: 'new' } });
  });

  it('reports missing keys as an error message', async () => {
    const d = deps(async () => {
      throw new ProviderError('no-key', 'none');
    });
    expect(await run(new ExplainService(d))).toEqual([
      { type: 'error', reqId: 0, code: 'no-key', message: 'none' },
    ]);
  });

  it('retries a 429 before any text and announces it', async () => {
    let calls = 0;
    const d = deps(
      provider(async function* () {
        calls++;
        if (calls === 1) throw new ProviderError('rate-limit', 'slow down', 429, 0);
        yield 'ok';
      }),
    );
    const msgs = await run(new ExplainService(d));
    expect(msgs.map((m) => m.type)).toEqual(['meta', 'retrying', 'chunk', 'done']);
  });

  it('does not cache partial text when a newer request supersedes it (FR-I5)', async () => {
    let release!: () => void;
    const gate = new Promise<void>((r) => (release = r));
    const d = deps(
      provider(async function* (signal) {
        yield 'part';
        await Promise.race([
          gate,
          new Promise((_r, rej) => signal.addEventListener('abort', () => rej(signal.reason))),
        ]);
        yield 'rest';
      }),
    );
    const svc = new ExplainService(d);
    const first: ExplainServerMsg[] = [];
    const p1 = svc.run(1, req, false, (m) => first.push(m));
    await new Promise((r) => setTimeout(r, 5));
    const second = run(svc, 2);
    release();
    await p1;
    await second;
    expect(first.some((m) => m.type === 'done' || m.type === 'error')).toBe(false);
    expect(d.putCached).toHaveBeenCalledTimes(1);
  });

  it('maps an empty answer to an error', async () => {
    const d = deps(
      provider(async function* () {
        yield '@@TYPE: other';
      }),
    );
    expect((await run(new ExplainService(d))).at(-1)).toMatchObject({ type: 'error', code: 'empty' });
  });
});
