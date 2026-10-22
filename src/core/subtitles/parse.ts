import { parseTtml } from './parse-ttml';
import type { RawCue } from './types';

export type SubtitleFormat = 'srt' | 'vtt' | 'ttml';

const TS = String.raw`(?:\d+:)?\d{1,2}:\d{1,2}(?:[.,]\d{1,3})?`;
const TIMING_RE = new RegExp(String.raw`^\s*(${TS})\s*-->\s*(${TS})`);
const INTEGER_RE = /^\s*\d+\s*$/;

/** `01:02:03,456`, `02:03.4`, `1:02:03` → seconds. Fraction digits are a decimal fraction. */
export function parseTimestamp(s: string): number {
  const [clock, frac = ''] = s.trim().split(/[.,]/);
  const parts = clock!.split(':').map(Number);
  let seconds = 0;
  for (const p of parts) seconds = seconds * 60 + p;
  if (frac) seconds += Number(frac) / 10 ** frac.length;
  return seconds;
}

export function isTimingLine(line: string | undefined): boolean {
  return line !== undefined && TIMING_RE.test(line);
}

const isBlank = (line: string | undefined) => line === undefined || line.trim() === '';

/**
 * One tolerant line-based parser for SRT and WebVTT.
 * Copes with CRLF, missing blank lines between cues, blank lines inside cue text,
 * comma or dot milliseconds, missing hours and VTT NOTE/STYLE/REGION blocks.
 */
function parseTimedLines(lines: string[], vtt: boolean): RawCue[] {
  const out: RawCue[] = [];
  let cur: { start: number; end: number; text: string[] } | null = null;
  let skipBlock = false;

  const close = () => {
    if (cur) out.push({ start: cur.start, end: cur.end, text: cur.text.join('\n') });
    cur = null;
  };

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i]!;

    if (skipBlock) {
      if (isBlank(line)) skipBlock = false;
      continue;
    }

    const timing = TIMING_RE.exec(line);
    if (timing) {
      close();
      cur = { start: parseTimestamp(timing[1]!), end: parseTimestamp(timing[2]!), text: [] };
      continue;
    }

    if (isBlank(line)) {
      if (!cur) continue;
      // A blank line ends the cue unless the next block is clearly more text of it.
      let j = i + 1;
      while (j < lines.length && isBlank(lines[j])) j++;
      const next = lines[j];
      if (
        j >= lines.length ||
        isTimingLine(next) ||
        isTimingLine(lines[j + 1]) ||
        (vtt && /^(NOTE|STYLE|REGION)\b/.test(next ?? ''))
      ) {
        close();
      }
      continue;
    }

    // A cue number / identifier directly followed by a timing line (no blank line before it).
    if (isTimingLine(lines[i + 1]) && (INTEGER_RE.test(line) || vtt || !cur)) {
      close();
      continue;
    }

    if (cur) {
      cur.text.push(line);
    } else if (vtt && /^(NOTE|STYLE|REGION)\b/.test(line)) {
      skipBlock = true;
    }
    // Anything else outside a cue (WEBVTT header, stray numbers) is ignored.
  }
  close();
  return out;
}

export function detectFormat(text: string, filename?: string): SubtitleFormat {
  if (/^\uFEFF?\s*WEBVTT/.test(text)) return 'vtt';
  if (/^\uFEFF?\s*(<\?xml[^>]*>\s*)?(<!--[\s\S]*?-->\s*)*<(\w+:)?tt[\s>]/.test(text)) return 'ttml';
  if (filename && /\.(ttml|dfxp)$/i.test(filename)) return 'ttml';
  if (filename && /\.vtt$/i.test(filename)) return 'vtt';
  return 'srt';
}

export class SubtitleParseError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'SubtitleParseError';
  }
}

export function parseSubtitles(text: string, filename?: string): { format: SubtitleFormat; cues: RawCue[] } {
  const format = detectFormat(text, filename);
  const body = text.replace(/^\uFEFF/, '');
  const cues =
    format === 'ttml' ? parseTtml(body) : parseTimedLines(body.split(/\r\n|\r|\n/), format === 'vtt');
  if (cues.length === 0) throw new SubtitleParseError('no cues found');
  return { format, cues };
}

export const parseSrt = (text: string) => parseTimedLines(text.split(/\r\n|\r|\n/), false);
export const parseVtt = (text: string) => parseTimedLines(text.split(/\r\n|\r|\n/), true);
