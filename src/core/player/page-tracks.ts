import type { RawCue } from '../subtitles/types';

export interface PageTrack {
  index: number;
  label: string;
  lang?: string;
}

const TEXT_KINDS = new Set(['subtitles', 'captions']);

/** Sites wrap labels in bidi controls (e.g. "English \u202A(en)\u202C"); they only confuse display and matching. */
const BIDI_CONTROLS = /[\u200e\u200f\u202a-\u202e\u2066-\u2069]/g;

/** Menu text for a track: the label, plus the language only when the label does not already show it. */
export function trackTitle(t: { label: string; lang?: string }): string {
  const lang = t.lang?.toLowerCase();
  const label = t.label.toLowerCase();
  if (!lang || label === lang || label.includes(`(${lang})`)) return t.label;
  return `${t.label} (${t.lang})`;
}

/** FR-S6: the page's own text tracks (`<track>` or script-added), whatever the site. */
export function listPageTracks(video: HTMLVideoElement): PageTrack[] {
  const out: PageTrack[] = [];
  const tracks = video.textTracks;
  for (let i = 0; i < tracks.length; i++) {
    const t = tracks[i]!;
    if (!TEXT_KINDS.has(t.kind)) continue;
    out.push({
      index: i,
      label: (t.label || t.language || `Track ${i + 1}`)
        .replace(BIDI_CONTROLS, '')
        .replace(/\s+/g, ' ')
        .trim(),
      ...(t.language ? { lang: t.language } : {}),
    });
  }
  return out;
}

function trackElementFor(video: HTMLVideoElement, track: TextTrack): HTMLTrackElement | undefined {
  return Array.from(video.querySelectorAll('track')).find((el) => el.track === track);
}

/**
 * Reads the cues of a page track. A disabled track has no cues, so it is switched to
 * `hidden` (loads without rendering) and restored afterwards. Cross-origin tracks without
 * CORS never load; that ends in an empty result, not an error.
 */
export async function readPageTrack(
  video: HTMLVideoElement,
  index: number,
  timeoutMs = 4000,
): Promise<RawCue[]> {
  const track = video.textTracks[index];
  if (!track) return [];
  const before = track.mode;
  if (before === 'disabled') track.mode = 'hidden';
  try {
    const el = trackElementFor(video, track);
    if (!track.cues?.length && el && el.readyState !== 2 /* LOADED */) {
      await new Promise<void>((resolve) => {
        const done = () => {
          clearTimeout(timer);
          el.removeEventListener('load', done);
          el.removeEventListener('error', done);
          resolve();
        };
        const timer = setTimeout(done, timeoutMs);
        el.addEventListener('load', done);
        el.addEventListener('error', done);
      });
    }
    const cues = track.cues ? Array.from(track.cues) : [];
    return cues.map((c) => ({
      start: c.startTime,
      end: c.endTime,
      text: 'text' in c ? String((c as VTTCue).text) : '',
    }));
  } finally {
    if (before === 'disabled') track.mode = 'disabled';
  }
}
