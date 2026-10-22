import { originPattern } from '../ai/providers';
import { ProviderError, type ProviderErrorCode } from '../ai/types';
import { loadSecrets, saveSecrets } from '../storage/secrets';
import { loadSettings } from '../storage/settings';
import { OpenSubtitlesClient, type OsDownload, type OsResult, type OsSearchParams } from './opensubtitles';

export type Failure = {
  ok: false;
  code: ProviderErrorCode | 'unknown';
  message: string;
  retryAfter?: number;
};

export function failure(e: unknown): Failure {
  if (e instanceof ProviderError) {
    return {
      ok: false,
      code: e.code,
      message: e.message,
      ...(e.retryAfter !== undefined ? { retryAfter: e.retryAfter } : {}),
    };
  }
  return { ok: false, code: 'unknown', message: e instanceof Error ? e.message : String(e) };
}

/** Hosts the OpenSubtitles integration needs: the API and the download links. */
export function osOrigins(baseUrl: string): string[] {
  const api = originPattern(baseUrl);
  const official = /\.opensubtitles\.(com|org)\//.test(`${baseUrl}/`);
  return [...new Set([...(api ? [api] : []), ...(official ? ['https://*.opensubtitles.com/*'] : [])])];
}

/** Login tokens are treated as valid for 23 h (the API issues 24 h tokens). */
const TOKEN_TTL_MS = 23 * 3600 * 1000;

async function client(): Promise<OpenSubtitlesClient> {
  const [settings, secrets] = await Promise.all([loadSettings(), loadSecrets()]);
  if (!secrets.osApiKey) throw new ProviderError('no-key', 'no OpenSubtitles API key');
  const tokenValid = !!secrets.osToken && (secrets.osTokenExpires ?? 0) > Date.now();
  const baseUrl = (tokenValid && secrets.osBaseUrl) || settings.sources.osBaseUrl;
  const origins = osOrigins(baseUrl);
  const granted = await browser.permissions.contains({ origins }).catch(() => false);
  if (!granted) throw new ProviderError('no-permission', `no host permission for ${origins.join(', ')}`);
  return new OpenSubtitlesClient({
    apiKey: secrets.osApiKey,
    baseUrl,
    ...(tokenValid && secrets.osToken ? { token: secrets.osToken } : {}),
  });
}

export async function osStatus(): Promise<{ configured: boolean; loggedIn: boolean; user?: string }> {
  const s = await loadSecrets();
  const loggedIn = !!s.osToken && (s.osTokenExpires ?? 0) > Date.now();
  return { configured: !!s.osApiKey, loggedIn, ...(loggedIn && s.osUser ? { user: s.osUser } : {}) };
}

export async function osSearch(params: OsSearchParams): Promise<{ ok: true; results: OsResult[] } | Failure> {
  try {
    return { ok: true, results: await (await client()).search(params) };
  } catch (e) {
    return failure(e);
  }
}

export async function osDownload(fileId: number): Promise<({ ok: true } & OsDownload) | Failure> {
  try {
    return { ok: true, ...(await (await client()).download(fileId)) };
  } catch (e) {
    return failure(e);
  }
}

export async function osLogin(
  username: string,
  password: string,
): Promise<{ ok: true; user: string; allowedDownloads?: number } | Failure> {
  try {
    const c = await client();
    const r = await c.login(username, password);
    await saveSecrets({
      osToken: r.token,
      osTokenExpires: Date.now() + TOKEN_TTL_MS,
      osUser: username,
      ...(r.baseUrl ? { osBaseUrl: r.baseUrl } : {}),
    });
    return {
      ok: true,
      user: username,
      ...(r.allowedDownloads !== undefined ? { allowedDownloads: r.allowedDownloads } : {}),
    };
  } catch (e) {
    return failure(e);
  }
}

export async function osLogout(): Promise<null> {
  await saveSecrets({ osToken: '', osTokenExpires: 0, osUser: '', osBaseUrl: '' });
  return null;
}
