import { afterEach, describe, expect, it, vi } from 'vitest';
import { LatestOnlyRunner, withFirstTokenTimeout, withRetries } from '../../src/core/ai/queue';
import { ProviderError } from '../../src/core/ai/types';

afterEach(() => vi.useRealTimers());

const opts = { retries: 2, baseDelayMs: 800, maxWaitMs: 20_000 };

describe('withRetries', () => {
  it('retries 429/5xx with exponential back-off', async () => {
    vi.useFakeTimers();
    const delays: number[] = [];
    const fn = vi
      .fn()
      .mockRejectedValueOnce(new ProviderError('server', '503', 503))
      .mockRejectedValueOnce(new ProviderError('rate-limit', '429', 429))
      .mockResolvedValue('ok');
    const p = withRetries(fn, { ...opts, onRetry: (_a, d) => delays.push(d) });
    await vi.runAllTimersAsync();
    await expect(p).resolves.toBe('ok');
    expect(fn).toHaveBeenCalledTimes(3);
    expect(delays).toEqual([800, 1600]);
  });

  it('honours Retry-After', async () => {
    vi.useFakeTimers();
    const delays: number[] = [];
    const fn = vi
      .fn()
      .mockRejectedValueOnce(new ProviderError('rate-limit', '429', 429, 3))
      .mockResolvedValue(1);
    const p = withRetries(fn, { ...opts, onRetry: (_a, d) => delays.push(d) });
    await vi.advanceTimersByTimeAsync(2999);
    expect(fn).toHaveBeenCalledTimes(1);
    await vi.advanceTimersByTimeAsync(1);
    await expect(p).resolves.toBe(1);
    expect(delays).toEqual([3000]);
  });

  it('gives up after two retries', async () => {
    vi.useFakeTimers();
    const fn = vi.fn().mockRejectedValue(new ProviderError('server', '500', 500));
    const p = withRetries(fn, opts);
    const assertion = expect(p).rejects.toMatchObject({ code: 'server' });
    await vi.runAllTimersAsync();
    await assertion;
    expect(fn).toHaveBeenCalledTimes(3);
  });

  it('does not wait out a very long Retry-After and does not retry other errors', async () => {
    const long = vi.fn().mockRejectedValue(new ProviderError('rate-limit', '429', 429, 60));
    await expect(withRetries(long, opts)).rejects.toMatchObject({ retryAfter: 60 });
    expect(long).toHaveBeenCalledTimes(1);
    const badKey = vi.fn().mockRejectedValue(new ProviderError('bad-key', '401', 401));
    await expect(withRetries(badKey, opts)).rejects.toMatchObject({ code: 'bad-key' });
    expect(badKey).toHaveBeenCalledTimes(1);
  });

  it('does not retry once text was shown', async () => {
    const e = new ProviderError('server', 'mid-stream');
    e.final = true;
    const fn = vi.fn().mockRejectedValue(e);
    await expect(withRetries(fn, opts)).rejects.toBe(e);
    expect(fn).toHaveBeenCalledTimes(1);
  });
});

describe('LatestOnlyRunner', () => {
  it('aborts the previous task when a new one starts', async () => {
    const r = new LatestOnlyRunner();
    let firstSignal: AbortSignal | undefined;
    const first = r.run(1, (s) => {
      firstSignal = s;
      return new Promise((_res, rej) => s.addEventListener('abort', () => rej(s.reason)));
    });
    const second = r.run(2, async () => 'two');
    await expect(first).rejects.toMatchObject({ code: 'aborted' });
    await expect(second).resolves.toBe('two');
    expect(firstSignal!.aborted).toBe(true);
  });

  it('cancels only the matching id', async () => {
    const r = new LatestOnlyRunner();
    let signal: AbortSignal | undefined;
    const p = r.run(5, (s) => {
      signal = s;
      return new Promise<void>((res) => setTimeout(res, 10));
    });
    r.cancel(4);
    expect(signal!.aborted).toBe(false);
    r.cancel(5);
    expect(signal!.aborted).toBe(true);
    await p;
  });
});

describe('withFirstTokenTimeout', () => {
  it('fails with timeout when the first token is late, but not after it', async () => {
    vi.useFakeTimers();
    async function* slow(signal: AbortSignal) {
      await new Promise((res, rej) => {
        const t = setTimeout(res, 20_000);
        signal.addEventListener('abort', () => {
          clearTimeout(t);
          rej(signal.reason);
        });
      });
      yield 'late';
    }
    const it1 = withFirstTokenTimeout(slow, new AbortController().signal, 15_000);
    const p = it1.next();
    const assertion = expect(p).rejects.toMatchObject({ code: 'timeout' });
    await vi.advanceTimersByTimeAsync(15_000);
    await assertion;

    async function* steady() {
      yield 'a';
      await new Promise((res) => setTimeout(res, 30_000));
      yield 'b';
    }
    const out: string[] = [];
    const run = (async () => {
      for await (const c of withFirstTokenTimeout(steady, new AbortController().signal, 15_000)) out.push(c);
    })();
    await vi.advanceTimersByTimeAsync(31_000);
    await run;
    expect(out).toEqual(['a', 'b']);
  });
});
