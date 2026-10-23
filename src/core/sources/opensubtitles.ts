import { errorFromFetch, errorFromResponse } from '../ai/http-errors';
import { ProviderError } from '../ai/types';
import { decodeSubtitleBytes } from '../subtitles/decode';
import type { MediaInfo } from '../subtitles/types';

/** FR-S7: OpenSubtitles REST API v1 with the user's own API key. Background only. */

export const OS_USER_AGENT = 'WhatchaSay v0.1.0';

export interface OsSearchParams {
  query?: string;
  season?: number;
  episode?: number;
  year?: number;
  /** Comma separated codes, e.g. "en" or "en,pt-br". */
  languages: string;
}

export interface OsResult {
  fileId: number;
  fileName: string;
  release: string;
  language: string;
  downloads: number;
  hearingImpaired: boolean;
  machineTranslated: boolean;
  fps?: number;
  /** What the subtitle belongs to — used to fill "What are we watching?" (M4). */
  media: MediaInfo;
}

export interface OsDownload {
  name: string;
  text: string;
  remaining?: number;
}

export interface OsAuth {
  apiKey: string;
  token?: string;
  baseUrl: string;
}

interface RawFeature {
  feature_type?: string;
  title?: string;
  movie_name?: string;
  parent_title?: string;
  year?: number;
  season_number?: number;
  episode_number?: number;
}

interface RawSubtitle {
  attributes?: {
    language?: string;
    release?: string;
    download_count?: number;
    hearing_impaired?: boolean;
    machine_translated?: boolean;
    ai_translated?: boolean;
    fps?: number;
    files?: { file_id: number; file_name?: string }[];
    feature_details?: RawFeature;
  };
}

/** Feature details → MediaInfo; episodes carry the show in `parent_title`. */
export function featureToMedia(f: RawFeature | undefined): MediaInfo {
  if (!f) return {};
  const episode = (f.feature_type ?? '').toLowerCase() === 'episode';
  const title = (episode ? f.parent_title : undefined) ?? f.title ?? f.movie_name;
  const out: MediaInfo = {};
  if (title) out.title = title;
  if (episode && f.season_number != null) out.season = f.season_number;
  if (episode && f.episode_number != null) out.episode = f.episode_number;
  if (f.year) out.year = f.year;
  return out;
}

/**
 * The API asks for sorted, lower-case parameters (otherwise it redirects). Season/episode
 * narrow the search to episodes.
 */
export function searchQuery(p: OsSearchParams): string {
  const params: [string, string][] = [];
  const q = p.query?.trim().toLowerCase();
  if (q) params.push(['query', q]);
  const langs = p.languages
    .split(',')
    .map((s) => s.trim().toLowerCase())
    .filter(Boolean)
    .sort()
    .join(',');
  if (langs) params.push(['languages', langs]);
  if (p.season != null) params.push(['season_number', String(p.season)]);
  if (p.episode != null) params.push(['episode_number', String(p.episode)]);
  if (p.year != null && p.season == null) params.push(['year', String(p.year)]);
  if (p.season != null || p.episode != null) params.push(['type', 'episode']);
  params.push(['order_by', 'download_count']);
  params.sort(([a], [b]) => a.localeCompare(b));
  return params.map(([k, v]) => `${k}=${encodeURIComponent(v)}`).join('&');
}

export function mapResults(body: unknown): OsResult[] {
  const data = (body as { data?: RawSubtitle[] })?.data ?? [];
  const out: OsResult[] = [];
  for (const item of data) {
    const a = item.attributes;
    const file = a?.files?.[0];
    if (!a || !file) continue;
    out.push({
      fileId: file.file_id,
      fileName: file.file_name ?? a.release ?? String(file.file_id),
      release: a.release ?? file.file_name ?? '',
      language: a.language ?? '',
      downloads: a.download_count ?? 0,
      hearingImpaired: !!a.hearing_impaired,
      machineTranslated: !!(a.machine_translated || a.ai_translated),
      ...(a.fps ? { fps: a.fps } : {}),
      media: featureToMedia(a.feature_details),
    });
  }
  return out;
}

export class OpenSubtitlesClient {
  private readonly fetch: typeof fetch;

  constructor(
    private readonly auth: OsAuth,
    fetchImpl?: typeof fetch,
  ) {
    this.fetch = fetchImpl ?? globalThis.fetch.bind(globalThis);
  }

  private headers(json = false): Record<string, string> {
    return {
      'Api-Key': this.auth.apiKey,
      'User-Agent': OS_USER_AGENT,
      Accept: 'application/json',
      ...(json ? { 'Content-Type': 'application/json' } : {}),
      ...(this.auth.token ? { Authorization: `Bearer ${this.auth.token}` } : {}),
    };
  }

  private async call(path: string, init: RequestInit, signal: AbortSignal): Promise<unknown> {
    if (!this.auth.apiKey) throw new ProviderError('no-key', 'no OpenSubtitles API key');
    let res: Response;
    try {
      res = await this.fetch(`${this.auth.baseUrl.replace(/\/+$/, '')}${path}`, { ...init, signal });
    } catch (e) {
      throw errorFromFetch(e, signal);
    }
    // 406 is how the API reports an exhausted daily download quota.
    if (res.status === 406) {
      const err = await errorFromResponse(res);
      throw new ProviderError('rate-limit', err.message, 406);
    }
    if (!res.ok) throw await errorFromResponse(res);
    return res.json();
  }

  async search(p: OsSearchParams, signal = new AbortController().signal): Promise<OsResult[]> {
    const body = await this.call(`/subtitles?${searchQuery(p)}`, { headers: this.headers() }, signal);
    return mapResults(body);
  }

  async download(fileId: number, signal = new AbortController().signal): Promise<OsDownload> {
    const meta = (await this.call(
      '/download',
      {
        method: 'POST',
        headers: this.headers(true),
        body: JSON.stringify({ file_id: fileId, sub_format: 'srt' }),
      },
      signal,
    )) as { link?: string; file_name?: string; remaining?: number };
    if (!meta.link) throw new ProviderError('bad-response', 'no download link');
    let res: Response;
    try {
      // The link is a short-lived signed URL; it needs no headers.
      res = await this.fetch(meta.link, { signal });
    } catch (e) {
      throw errorFromFetch(e, signal);
    }
    if (!res.ok) throw await errorFromResponse(res);
    const { text } = decodeSubtitleBytes(new Uint8Array(await res.arrayBuffer()));
    return {
      name: meta.file_name ?? `opensubtitles-${fileId}.srt`,
      text,
      ...(meta.remaining !== undefined ? { remaining: meta.remaining } : {}),
    };
  }

  /** Returns a token and, for VIP accounts, a different API host. The password is not kept. */
  async login(
    username: string,
    password: string,
    signal = new AbortController().signal,
  ): Promise<{ token: string; baseUrl?: string; allowedDownloads?: number }> {
    const body = (await this.call(
      '/login',
      { method: 'POST', headers: this.headers(true), body: JSON.stringify({ username, password }) },
      signal,
    )) as { token?: string; base_url?: string; user?: { allowed_downloads?: number } };
    if (!body.token) throw new ProviderError('bad-response', 'no token');
    return {
      token: body.token,
      ...(body.base_url ? { baseUrl: `https://${body.base_url.replace(/^https?:\/\//, '')}/api/v1` } : {}),
      ...(body.user?.allowed_downloads !== undefined
        ? { allowedDownloads: body.user.allowed_downloads }
        : {}),
    };
  }
}
