import { ProviderError } from './types';

/** `Retry-After` (seconds or HTTP date) → seconds. */
export function parseRetryAfter(header: string | null, now = Date.now()): number | undefined {
  if (!header) return undefined;
  const secs = Number(header);
  if (Number.isFinite(secs)) return Math.max(0, secs);
  const date = Date.parse(header);
  return Number.isFinite(date) ? Math.max(0, Math.round((date - now) / 1000)) : undefined;
}

/** Gemini puts the hint in `error.details[].retryDelay` ("12s" or "1.5s"). */
function retryFromBody(body: unknown): number | undefined {
  const details = (body as { error?: { details?: { retryDelay?: string }[] } })?.error?.details;
  const delay = details?.find((d) => typeof d?.retryDelay === 'string')?.retryDelay;
  const m = delay ? /^([\d.]+)s$/.exec(delay) : null;
  return m ? Math.ceil(Number(m[1])) : undefined;
}

function messageFromBody(body: unknown, fallback: string): string {
  const b = body as { error?: { message?: string } | string; message?: string };
  if (typeof b?.error === 'string') return b.error;
  return b?.error?.message ?? b?.message ?? fallback;
}

/** Maps an unsuccessful HTTP response to a ProviderError. Never includes request headers (keys). */
export async function errorFromResponse(res: Response): Promise<ProviderError> {
  let body: unknown = null;
  try {
    body = await res.json();
  } catch {
    // Non-JSON error page.
  }
  const msg = messageFromBody(body, `HTTP ${res.status}`).slice(0, 300);
  const retryAfter = parseRetryAfter(res.headers.get('retry-after')) ?? retryFromBody(body);
  const s = res.status;
  if (s === 401 || s === 403 || (s === 400 && /api[ _-]?key/i.test(msg))) {
    return new ProviderError('bad-key', msg, s);
  }
  if (s === 429) return new ProviderError('rate-limit', msg, s, retryAfter);
  if (s >= 500) return new ProviderError('server', msg, s, retryAfter);
  return new ProviderError('bad-response', msg, s);
}

/** fetch() rejections: aborts stay aborts, everything else is "no network". */
export function errorFromFetch(e: unknown, signal: AbortSignal): ProviderError {
  if (signal.aborted) {
    const reason = signal.reason;
    return reason instanceof ProviderError ? reason : new ProviderError('aborted', 'aborted');
  }
  if (e instanceof ProviderError) return e;
  return new ProviderError('network', e instanceof Error ? e.message : String(e));
}
