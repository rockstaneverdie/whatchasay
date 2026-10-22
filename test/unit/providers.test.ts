import { describe, expect, it, vi } from 'vitest';
import { parseRetryAfter } from '../../src/core/ai/http-errors';
import { GeminiProvider, thinkingConfigFor } from '../../src/core/ai/provider-gemini';
import { OpenAICompatProvider } from '../../src/core/ai/provider-openai-compat';
import type { ExplainRequest } from '../../src/core/ai/types';

const req: ExplainRequest = {
  media: { title: 'Maple Street' },
  transcriptHash: 'h',
  transcript: [{ id: 1, speaker: 'MAYA', text: 'Back to square one.' }],
  target: { cueId: 1 },
  prev: [],
  next: [],
  level: 'B1',
  outLang: 'ru',
  mode: 'short',
  onlyPast: false,
};

function sse(events: unknown[], split = 7): Response {
  const text = events.map((e) => `data: ${typeof e === 'string' ? e : JSON.stringify(e)}\r\n\r\n`).join('');
  const bytes = new TextEncoder().encode(text);
  return new Response(
    new ReadableStream({
      start(c) {
        for (let i = 0; i < bytes.length; i += split) c.enqueue(bytes.slice(i, i + split));
        c.close();
      },
    }),
    { status: 200, headers: { 'content-type': 'text/event-stream' } },
  );
}

const json = (status: number, body: unknown, headers: Record<string, string> = {}) =>
  new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json', ...headers } });

async function drain(it: AsyncIterable<string>) {
  let s = '';
  for await (const c of it) s += c;
  return s;
}

const geminiChunk = (text: string, extra: object = {}) => ({
  candidates: [{ content: { parts: [{ text }] }, ...extra }],
});

describe('GeminiProvider', () => {
  it('posts to streamGenerateContent with the key in a header, never in the URL', async () => {
    const fetch = vi.fn().mockResolvedValue(sse([geminiChunk('Они '), geminiChunk('начинают заново.')]));
    const p = new GeminiProvider({ apiKey: 'SECRET', model: 'gemini-3.8-flash', fetch });
    expect(await drain(p.explain(req, new AbortController().signal))).toBe('Они начинают заново.');
    const [url, init] = fetch.mock.calls[0]!;
    expect(url).toBe(
      'https://generativelanguage.googleapis.com/v1beta/models/gemini-3.8-flash:streamGenerateContent?alt=sse',
    );
    expect(String(url)).not.toContain('SECRET');
    expect(init.headers['x-goog-api-key']).toBe('SECRET');
    const body = JSON.parse(init.body);
    expect(body.systemInstruction.parts[0].text).toContain('CEFR level B1');
    expect(body.contents[0].parts[0].text).toContain('TARGET: [1] MAYA: Back to square one.');
    expect(body.generationConfig.thinkingConfig).toEqual({ thinkingLevel: 'low' });
  });

  it('skips thought parts', async () => {
    const fetch = vi
      .fn()
      .mockResolvedValue(
        sse([{ candidates: [{ content: { parts: [{ text: 'hmm', thought: true }, { text: 'answer' }] } }] }]),
      );
    const p = new GeminiProvider({ apiKey: 'k', model: 'gemini-3.8-flash', fetch });
    expect(await drain(p.explain(req, new AbortController().signal))).toBe('answer');
  });

  it('maps HTTP errors', async () => {
    const cases: [Response, string, number?][] = [
      [json(400, { error: { message: 'API key not valid. Please pass a valid API key.' } }), 'bad-key'],
      [json(403, { error: { message: 'denied' } }), 'bad-key'],
      [
        json(429, { error: { message: 'quota', details: [{ '@type': 'RetryInfo', retryDelay: '12s' }] } }),
        'rate-limit',
        12,
      ],
      [json(429, {}, { 'retry-after': '7' }), 'rate-limit', 7],
      [json(503, { error: { message: 'overloaded' } }), 'server'],
      [json(404, { error: { message: 'model not found' } }), 'bad-response'],
    ];
    for (const [res, code, retryAfter] of cases) {
      const p = new GeminiProvider({ apiKey: 'k', model: 'gemini-x', fetch: vi.fn().mockResolvedValue(res) });
      await expect(drain(p.explain(req, new AbortController().signal))).rejects.toMatchObject({
        code,
        ...(retryAfter ? { retryAfter } : {}),
      });
    }
  });

  it('reports network failures, blocked prompts and empty answers', async () => {
    const net = new GeminiProvider({
      apiKey: 'k',
      model: 'm',
      fetch: vi.fn().mockRejectedValue(new TypeError('NetworkError')),
    });
    await expect(drain(net.explain(req, new AbortController().signal))).rejects.toMatchObject({
      code: 'network',
    });

    const blocked = new GeminiProvider({
      apiKey: 'k',
      model: 'm',
      fetch: vi.fn().mockResolvedValue(sse([{ promptFeedback: { blockReason: 'SAFETY' } }])),
    });
    await expect(drain(blocked.explain(req, new AbortController().signal))).rejects.toMatchObject({
      code: 'blocked',
    });

    const empty = new GeminiProvider({
      apiKey: 'k',
      model: 'm',
      fetch: vi.fn().mockResolvedValue(sse([{ candidates: [{ finishReason: 'STOP' }] }])),
    });
    await expect(drain(empty.explain(req, new AbortController().signal))).rejects.toMatchObject({
      code: 'empty',
    });
  });

  it('requires a key', async () => {
    const p = new GeminiProvider({ apiKey: '', model: 'm', fetch: vi.fn() });
    await expect(drain(p.explain(req, new AbortController().signal))).rejects.toMatchObject({
      code: 'no-key',
    });
  });

  it('retries once without thinkingConfig if the model rejects it', async () => {
    const fetch = vi
      .fn()
      .mockResolvedValueOnce(
        json(400, { error: { message: 'thinking_level is not supported for this model' } }),
      )
      .mockResolvedValueOnce(sse([geminiChunk('ok')]));
    const p = new GeminiProvider({ apiKey: 'k', model: 'gemini-3.5-flash-lite', fetch });
    expect(await drain(p.explain(req, new AbortController().signal))).toBe('ok');
    expect(JSON.parse(fetch.mock.calls[1]![1].body).generationConfig.thinkingConfig).toBeUndefined();
  });

  it('lists generateContent models across pages', async () => {
    const fetch = vi
      .fn()
      .mockResolvedValueOnce(
        json(200, {
          models: [
            {
              name: 'models/gemini-3.8-flash',
              displayName: 'Gemini 3.8 Flash',
              supportedGenerationMethods: ['generateContent'],
            },
            { name: 'models/embedding-x', supportedGenerationMethods: ['embedContent'] },
          ],
          nextPageToken: 'p2',
        }),
      )
      .mockResolvedValueOnce(
        json(200, {
          models: [{ name: 'models/gemini-3.5-flash-lite', supportedGenerationMethods: ['generateContent'] }],
        }),
      );
    const p = new GeminiProvider({ apiKey: 'k', model: 'm', fetch });
    expect((await p.listModels()).map((m) => m.id)).toEqual(['gemini-3.8-flash', 'gemini-3.5-flash-lite']);
    expect(fetch.mock.calls[1]![0]).toContain('pageToken=p2');
  });

  it('only asks newer models to think less', () => {
    expect(thinkingConfigFor('gemini-3.8-flash')).toBeDefined();
    expect(thinkingConfigFor('gemini-4-argon')).toBeDefined();
    expect(thinkingConfigFor('gemini-2.5-flash')).toBeUndefined();
  });
});

describe('OpenAICompatProvider', () => {
  it('streams chat completions and stops at [DONE]', async () => {
    const fetch = vi
      .fn()
      .mockResolvedValue(
        sse([
          { choices: [{ delta: { content: 'Hel' } }] },
          { choices: [{ delta: { content: 'lo' } }] },
          '[DONE]',
        ]),
      );
    const p = new OpenAICompatProvider({
      baseUrl: 'http://localhost:11434/v1/',
      apiKey: '',
      model: 'llama',
      fetch,
    });
    expect(await drain(p.explain(req, new AbortController().signal))).toBe('Hello');
    const [url, init] = fetch.mock.calls[0]!;
    expect(url).toBe('http://localhost:11434/v1/chat/completions');
    expect(init.headers.authorization).toBeUndefined();
    expect(JSON.parse(init.body).messages[0].role).toBe('system');
  });

  it('sends a bearer key when set and lists models', async () => {
    const fetch = vi.fn().mockResolvedValue(json(200, { data: [{ id: 'b' }, { id: 'a' }] }));
    const p = new OpenAICompatProvider({
      baseUrl: 'https://api.groq.com/openai/v1',
      apiKey: 'gsk',
      model: 'x',
      fetch,
    });
    expect((await p.listModels()).map((m) => m.id)).toEqual(['a', 'b']);
    expect(fetch.mock.calls[0]![1].headers.authorization).toBe('Bearer gsk');
  });
});

describe('parseRetryAfter', () => {
  it('reads seconds and dates', () => {
    expect(parseRetryAfter('5')).toBe(5);
    expect(parseRetryAfter(new Date(10_000).toUTCString(), 0)).toBe(10);
    expect(parseRetryAfter(null)).toBeUndefined();
  });
});
