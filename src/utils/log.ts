/** NFR-10: everything we log carries the prefix; nothing we throw may break the page. */
export const log = {
  info: (...args: unknown[]) => console.info('[subtext]', ...args),
  warn: (...args: unknown[]) => console.warn('[subtext]', ...args),
  error: (...args: unknown[]) => console.error('[subtext]', ...args),
};

export function safe<T>(fn: () => T): T | undefined {
  try {
    return fn();
  } catch (e) {
    log.error(e);
    return undefined;
  }
}
