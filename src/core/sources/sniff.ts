import type { SubtitleFormat } from '../subtitles/parse';

/**
 * FR-S8: recognises subtitle files among the responses a page receives — by content type or file
 * extension only, never by site. Media, playlists and manifests are ignored on purpose: WhatchaSay? does
 * not collect stream links.
 */

const BY_TYPE: Record<string, SubtitleFormat> = {
  'text/vtt': 'vtt',
  'text/webvtt': 'vtt',
  'application/x-subrip': 'srt',
  'application/x-srt': 'srt',
  'text/srt': 'srt',
  'text/x-srt': 'srt',
  'application/ttml+xml': 'ttml',
  'application/ttaf+xml': 'ttml',
  'application/dfxp+xml': 'ttml',
};

const BY_EXT: Record<string, SubtitleFormat> = {
  vtt: 'vtt',
  webvtt: 'vtt',
  srt: 'srt',
  ttml: 'ttml',
  dfxp: 'ttml',
};

const NEVER = /^(video|audio|image|font)\/|mpegurl|dash\+xml|text\/html|javascript|text\/css/i;

export function classifySubtitle(url: string, contentType: string | undefined): SubtitleFormat | null {
  const ct = (contentType ?? '').split(';')[0]!.trim().toLowerCase();
  if (ct && BY_TYPE[ct]) return BY_TYPE[ct];
  if (ct && NEVER.test(ct)) return null;
  let path: string;
  try {
    path = new URL(url).pathname.toLowerCase();
  } catch {
    return null;
  }
  const ext = /\.([a-z0-9]+)$/.exec(path)?.[1];
  return ext ? (BY_EXT[ext] ?? null) : null;
}

/** Segmented subtitles (`seg-1.vtt`, `seg-2.vtt`, …) share one key: the last number of the file name becomes `#`. */
export function groupKeyOf(url: string): string {
  try {
    const u = new URL(url);
    const parts = u.pathname.split('/');
    const file = parts.pop() ?? '';
    parts.push(file.replace(/\d+(?=\D*\.[a-z0-9]+$)/i, '#'));
    return `${u.origin}${parts.join('/')}`;
  } catch {
    return url;
  }
}

/** Sequence number of a segment for ordering; 0 when there is none. */
export function segmentIndex(url: string): number {
  try {
    const file = new URL(url).pathname.split('/').pop() ?? '';
    const m = /(\d+)(?=\D*\.[a-z0-9]+$)/i.exec(file);
    return m ? Number(m[1]) : 0;
  } catch {
    return 0;
  }
}

const LANGS = [
  'en',
  'eng',
  'ru',
  'rus',
  'de',
  'deu',
  'fr',
  'fra',
  'es',
  'spa',
  'pt',
  'por',
  'it',
  'ita',
  'ja',
  'jpn',
  'ko',
  'kor',
  'zh',
  'chi',
  'uk',
  'ukr',
  'pl',
  'pol',
];
const LANG_RE = new RegExp(`(?:^|[/_.\\-=])(${LANGS.join('|')})(?:[-_](?:[a-z]{2}))?(?=$|[/_.\\-&])`, 'i');

export function langHint(url: string): string | undefined {
  try {
    const u = new URL(url);
    return LANG_RE.exec(`${u.pathname}${u.search}`)?.[1]?.toLowerCase();
  } catch {
    return undefined;
  }
}

export interface SniffedGroup {
  key: string;
  format: SubtitleFormat;
  lang?: string;
  /** Distinct URLs, ordered by segment number then arrival. */
  urls: string[];
  label: string;
  firstSeen: number;
}

export interface SniffedSummary {
  key: string;
  label: string;
  format: SubtitleFormat;
  lang?: string;
  parts: number;
}

const MAX_GROUPS = 30;
const MAX_URLS = 600;

/** Per-tab store of spotted subtitle files. Pure; the background feeds it from webRequest. */
export class SniffStore {
  private readonly tabs = new Map<number, Map<string, SniffedGroup>>();

  add(tabId: number, url: string, contentType: string | undefined, now = Date.now()): boolean {
    const format = classifySubtitle(url, contentType);
    if (!format) return false;
    let groups = this.tabs.get(tabId);
    if (!groups) this.tabs.set(tabId, (groups = new Map()));
    const key = groupKeyOf(url);
    let g = groups.get(key);
    if (!g) {
      if (groups.size >= MAX_GROUPS) return false;
      const file = key.split('/').pop() ?? key;
      const lang = langHint(url);
      g = { key, format, ...(lang ? { lang } : {}), urls: [], label: file.replace('#', '*'), firstSeen: now };
      groups.set(key, g);
    }
    if (g.urls.includes(url) || g.urls.length >= MAX_URLS) return false;
    g.urls.push(url);
    g.urls.sort((a, b) => segmentIndex(a) - segmentIndex(b));
    return true;
  }

  list(tabId: number): SniffedSummary[] {
    return [...(this.tabs.get(tabId)?.values() ?? [])]
      .sort((a, b) => a.firstSeen - b.firstSeen)
      .map((g) => ({
        key: g.key,
        label: g.label,
        format: g.format,
        ...(g.lang ? { lang: g.lang } : {}),
        parts: g.urls.length,
      }));
  }

  urls(tabId: number, key: string): string[] {
    return [...(this.tabs.get(tabId)?.get(key)?.urls ?? [])];
  }

  clear(tabId: number): void {
    this.tabs.delete(tabId);
  }
}
