import { ProviderError } from './types';

export interface RetryOptions {
  retries: number;
  baseDelayMs: number;
  /** A Retry-After longer than this is not waited out; the error goes to the user with a timer. */
  maxWaitMs: number;
  signal?: AbortSignal;
  onRetry?: (attempt: number, delayMs: number, error: ProviderError) => void;
  sleep?: (ms: number, signal?: AbortSignal) => Promise<void>;
}

export const DEFAULT_RETRY: Omit<RetryOptions, 'signal' | 'onRetry'> = {
  retries: 2,
  baseDelayMs: 800,
  maxWaitMs: 20_000,
};

export function abortableSleep(ms: number, signal?: AbortSignal): Promise<void> {
  return new Promise((resolve, reject) => {
    if (signal?.aborted) return reject(signal.reason);
    const t = setTimeout(() => {
      signal?.removeEventListener('abort', onAbort);
      resolve();
    }, ms);
    const onAbort = () => {
      clearTimeout(t);
      reject(signal?.reason);
    };
    signal?.addEventListener('abort', onAbort, { once: true });
  });
}

/** FR-A6: retries 429/5xx up to `retries` times with exponential back-off, honouring Retry-After. */
export async function withRetries<T>(fn: (attempt: number) => Promise<T>, opts: RetryOptions): Promise<T> {
  const sleep = opts.sleep ?? abortableSleep;
  for (let attempt = 0; ; attempt++) {
    try {
      return await fn(attempt);
    } catch (e) {
      if (!(e instanceof ProviderError) || !e.retryable || attempt >= opts.retries || opts.signal?.aborted)
        throw e;
      const delay = e.retryAfter !== undefined ? e.retryAfter * 1000 : opts.baseDelayMs * 2 ** attempt;
      if (delay > opts.maxWaitMs) throw e;
      opts.onRetry?.(attempt + 1, delay, e);
      await sleep(delay, opts.signal);
    }
  }
}

/** FR-A6: one active request; starting a new one aborts the previous. */
export class LatestOnlyRunner {
  private current: { id: number; controller: AbortController } | null = null;

  run<T>(id: number, task: (signal: AbortSignal) => Promise<T>): Promise<T> {
    this.current?.controller.abort(new ProviderError('aborted', 'superseded'));
    const controller = new AbortController();
    this.current = { id, controller };
    return task(controller.signal).finally(() => {
      if (this.current?.id === id) this.current = null;
    });
  }

  cancel(id?: number): void {
    if (!this.current || (id !== undefined && this.current.id !== id)) return;
    this.current.controller.abort(new ProviderError('aborted', 'cancelled'));
    this.current = null;
  }

  get activeId(): number | null {
    return this.current?.id ?? null;
  }
}

/**
 * Wraps a token stream: fails with `timeout` if the first token takes longer than `firstTokenMs`
 * (FR-I6: 15 s). The timer only guards the first token.
 */
export async function* withFirstTokenTimeout(
  make: (signal: AbortSignal) => AsyncIterable<string>,
  outer: AbortSignal,
  firstTokenMs: number,
): AsyncGenerator<string> {
  const inner = new AbortController();
  const onAbort = () => inner.abort(outer.reason);
  outer.addEventListener('abort', onAbort, { once: true });
  let timedOut = false;
  const timer = setTimeout(() => {
    timedOut = true;
    inner.abort(new ProviderError('timeout', `no first token within ${firstTokenMs} ms`));
  }, firstTokenMs);
  try {
    let first = true;
    for await (const chunk of make(inner.signal)) {
      if (first) {
        clearTimeout(timer);
        first = false;
      }
      yield chunk;
    }
  } catch (e) {
    if (timedOut) throw new ProviderError('timeout', `no first token within ${firstTokenMs} ms`);
    throw e;
  } finally {
    clearTimeout(timer);
    outer.removeEventListener('abort', onAbort);
  }
}
