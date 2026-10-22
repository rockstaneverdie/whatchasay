import type { ExplainClientMsg, ExplainServerMsg } from '../messaging/types';
import { getCached, putCached } from '../storage/cache';
import { loadSecrets, type Secrets } from '../storage/secrets';
import { loadSettings, type Settings } from '../storage/settings';
import { cacheKey } from './cache-key';
import { createProvider, providerModel } from './providers';
import { DEFAULT_RETRY, LatestOnlyRunner, withFirstTokenTimeout, withRetries } from './queue';
import { ResponseParser } from './response-parser';
import { ProviderError, type ExplainRequest, type Provider } from './types';

export const FIRST_TOKEN_TIMEOUT_MS = 15_000;

export interface ExplainDeps {
  loadSettings: () => Promise<Settings>;
  loadSecrets: () => Promise<Secrets>;
  createProvider: (s: Settings, k: Secrets) => Promise<Provider>;
  getCached: typeof getCached;
  putCached: typeof putCached;
  firstTokenMs: number;
  retry: typeof DEFAULT_RETRY;
}

const defaultDeps: ExplainDeps = {
  loadSettings,
  loadSecrets,
  createProvider,
  getCached,
  putCached,
  firstTokenMs: FIRST_TOKEN_TIMEOUT_MS,
  retry: DEFAULT_RETRY,
};

/** Background side of the explain port (TZ 6.7). One active request across all tabs (FR-A6). */
export class ExplainService {
  private readonly runner = new LatestOnlyRunner();
  private readonly owners = new Map<number, (msg: ExplainServerMsg) => void>();
  private seq = 0;

  constructor(private readonly deps: ExplainDeps = defaultDeps) {}

  /** Wires a runtime port. Request ids from the content script are mapped to global ids. */
  attach(port: {
    postMessage(m: unknown): void;
    onMessage: { addListener(fn: (m: unknown) => void): void };
    onDisconnect: { addListener(fn: () => void): void };
  }): void {
    const local = new Map<number, number>();
    const post = (m: ExplainServerMsg) => {
      try {
        port.postMessage(m);
      } catch {
        // Port went away mid-stream; the request is cancelled below.
      }
    };
    port.onMessage.addListener((raw) => {
      const msg = raw as ExplainClientMsg;
      if (msg?.type === 'start') {
        const id = ++this.seq;
        local.set(msg.reqId, id);
        void this.run(id, msg.req, !!msg.force, (m) => post({ ...m, reqId: msg.reqId }));
      } else if (msg?.type === 'cancel') {
        const id = local.get(msg.reqId);
        if (id !== undefined) this.runner.cancel(id);
      }
    });
    port.onDisconnect.addListener(() => {
      for (const id of local.values()) this.runner.cancel(id);
    });
  }

  run(id: number, req: ExplainRequest, force: boolean, emit: (m: ExplainServerMsg) => void): Promise<void> {
    return this.runner
      .run(id, (signal) => this.execute(req, force, signal, emit))
      .catch((e: unknown) => {
        const err =
          e instanceof ProviderError
            ? e
            : new ProviderError('bad-response', e instanceof Error ? e.message : String(e));
        if (err.code === 'aborted') return;
        emit({
          type: 'error',
          reqId: 0,
          code: err.code,
          message: err.message,
          ...(err.retryAfter !== undefined ? { retryAfter: err.retryAfter } : {}),
        });
      });
  }

  private async execute(
    req: ExplainRequest,
    force: boolean,
    signal: AbortSignal,
    emit: (m: ExplainServerMsg) => void,
  ): Promise<void> {
    const d = this.deps;
    const settings = await d.loadSettings();
    const key = await cacheKey(req, settings.provider);
    const model = providerModel(settings);

    if (!force) {
      const hit = await d.getCached(key);
      if (hit) {
        emit({ type: 'meta', reqId: 0, cacheKey: key, cached: true, model: hit.model });
        emit({ type: 'chunk', reqId: 0, text: hit.text });
        emit({
          type: 'done',
          reqId: 0,
          cacheKey: key,
          result: {
            text: hit.text,
            type: hit.type,
            confidence: hit.confidence,
            ...(hit.expr ? { expr: hit.expr } : {}),
          },
        });
        return;
      }
    }

    const provider = await d.createProvider(settings, await d.loadSecrets());
    emit({ type: 'meta', reqId: 0, cacheKey: key, cached: false, model });

    const parser = new ResponseParser();
    let streamed = false;
    await withRetries(
      async () => {
        try {
          for await (const chunk of withFirstTokenTimeout(
            (s) => provider.explain(req, s),
            signal,
            d.firstTokenMs,
          )) {
            streamed = true;
            const visible = parser.push(chunk);
            if (visible) emit({ type: 'chunk', reqId: 0, text: visible });
          }
        } catch (e) {
          // Retries happen only before anything was shown; once text streams, errors surface.
          if (streamed && e instanceof ProviderError) e.final = true;
          throw e;
        }
      },
      {
        ...d.retry,
        signal,
        onRetry: (attempt, delayMs) => emit({ type: 'retrying', reqId: 0, attempt, delayMs }),
      },
    );
    if (signal.aborted) return;

    const result = parser.finish();
    if (!result.text) throw new ProviderError('empty', 'empty explanation');
    await d.putCached(key, result, model, settings.cacheMaxMB * 1024 * 1024).catch(() => {});
    emit({ type: 'done', reqId: 0, cacheKey: key, result });
  }
}
