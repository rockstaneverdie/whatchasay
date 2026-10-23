/** NFR-10: everything we log carries the prefix; nothing we throw may break the page. */
export const log = {
  info: (...args: unknown[]) => console.info('[whatchasay]', ...args),
  warn: (...args: unknown[]) => console.warn('[whatchasay]', ...args),
  error: (...args: unknown[]) => console.error('[whatchasay]', ...args),
};

export function safe<T>(fn: () => T): T | undefined {
  try {
    return fn();
  } catch (e) {
    log.error(e);
    return undefined;
  }
}
