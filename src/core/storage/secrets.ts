/**
 * API keys. NFR-4: storage.local only (never sync), never logged, never sent to content scripts.
 * Only the background, options and popup pages import this module.
 */
export interface Secrets {
  geminiKey?: string;
  openaiKey?: string;
  /** OpenSubtitles consumer API key (BYOK, FR-S7). */
  osApiKey?: string;
  /** OpenSubtitles login token (JWT). The password itself is never stored. */
  osToken?: string;
  /** Epoch ms after which the token is treated as expired. */
  osTokenExpires?: number;
  osUser?: string;
  /** VIP accounts get their own API host from /login. */
  osBaseUrl?: string;
}

const KEY = 'secrets';

export async function loadSecrets(): Promise<Secrets> {
  return ((await browser.storage.local.get(KEY))[KEY] as Secrets | undefined) ?? {};
}

export async function saveSecrets(patch: Secrets): Promise<void> {
  const next = { ...(await loadSecrets()), ...patch };
  for (const k of Object.keys(next) as (keyof Secrets)[]) if (!next[k]) delete next[k];
  await browser.storage.local.set({ [KEY]: next });
}
