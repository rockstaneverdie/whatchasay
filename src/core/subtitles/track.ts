import { sha256Hex } from '../../utils/hash';
import { decodeSubtitleBytes, type SubtitleEncoding } from './decode';
import { normalizeCues } from './normalize';
import { parseSubtitles } from './parse';
import type { Cue, RawCue, Track, TrackSource } from './types';

/** TZ 6.2: trackId = first 16 hex of sha256(normalised text of all cues). */
export async function computeTrackId(cues: Cue[]): Promise<string> {
  return (await sha256Hex(cues.map((c) => c.lines.join('\n')).join('\n\n'))).slice(0, 16);
}

export async function buildTrack(
  raw: RawCue[],
  meta: { label: string; source: TrackSource; lang?: string },
): Promise<Track> {
  const cues = normalizeCues(raw);
  return {
    id: await computeTrackId(cues),
    label: meta.label,
    ...(meta.lang ? { lang: meta.lang } : {}),
    source: meta.source,
    cues,
    offsetMs: 0,
  };
}

export async function trackFromFile(
  bytes: ArrayBuffer | Uint8Array,
  filename: string,
  encoding?: SubtitleEncoding,
): Promise<{ track: Track; encoding: SubtitleEncoding }> {
  const decoded = decodeSubtitleBytes(bytes, encoding);
  const { cues } = parseSubtitles(decoded.text, filename);
  const track = await buildTrack(cues, { label: filename, source: 'file' });
  return { track, encoding: decoded.encoding };
}
