import type { MediaInfo } from './types';

const PATTERNS: RegExp[] = [
  // Name.S01E02, Name S1E2, name_s01e02
  /^(?<name>.*?)[\s._-]*\bS(?<season>\d{1,2})[\s._-]?E(?<episode>\d{1,3})\b/i,
  // Name 1x02
  /^(?<name>.*?)[\s._-]*\b(?<season>\d{1,2})x(?<episode>\d{1,3})\b/i,
  // Name - Season 1 Episode 2
  /^(?<name>.*?)[\s._,:-]*\bSeason[\s._]*(?<season>\d{1,2})[\s._,:-]*Episode[\s._]*(?<episode>\d{1,3})\b/i,
];

const YEAR_RE = /(?:^|[\s._([])((?:19|20)\d{2})(?:$|[\s._)\]])/;

function cleanName(name: string): string {
  return name
    .replace(/\.(srt|vtt)$/i, '')
    .replace(/[._]+/g, ' ')
    .replace(/[([](?:19|20)\d{2}[)\]]/g, '')
    .replace(/\b(?:19|20)\d{2}\b\s*$/, '')
    .replace(/[\s\-–—:|]+$/, '')
    .replace(/^[\s\-–—:|]+/, '')
    .replace(/\s+/g, ' ')
    .trim();
}

/** FR-M2: guesses show / season / episode / year from a file name or page title. */
export function parseMediaInfo(source: string): MediaInfo {
  const s = source.trim();
  const info: MediaInfo = {};
  for (const re of PATTERNS) {
    const m = re.exec(s);
    if (m?.groups) {
      info.season = Number(m.groups.season);
      info.episode = Number(m.groups.episode);
      const name = cleanName(m.groups.name ?? '');
      if (name) info.title = name;
      break;
    }
  }
  const year = YEAR_RE.exec(s);
  if (year) {
    const y = Number(year[1]);
    if (y >= 1900 && y <= 2100) info.year = y;
  }
  return info;
}

/** File name wins over page title; title fills the gaps. */
export function guessMediaInfo(filename: string | undefined, pageTitle: string | undefined): MediaInfo {
  const fromFile = filename ? parseMediaInfo(filename) : {};
  const fromTitle = pageTitle ? parseMediaInfo(pageTitle) : {};
  const merged: MediaInfo = { ...fromTitle, ...fromFile };
  if (!merged.title && pageTitle) {
    const first = pageTitle.split(/\s[|•·]\s/)[0]?.trim();
    if (first) merged.title = first;
  }
  return merged;
}

export function formatMediaInfo(m: MediaInfo): string {
  const parts: string[] = [];
  if (m.title) parts.push(m.title);
  if (m.season != null && m.episode != null) {
    parts.push(`S${String(m.season).padStart(2, '0')}E${String(m.episode).padStart(2, '0')}`);
  } else if (m.season != null) {
    parts.push(`S${String(m.season).padStart(2, '0')}`);
  }
  if (m.year) parts.push(`(${m.year})`);
  return parts.join(' ');
}
