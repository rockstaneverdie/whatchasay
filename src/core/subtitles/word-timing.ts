import type { Cue, WordTiming } from './types';

/** Seconds at the end of a cue window that are not given to speech (TZ 6.4). */
export const TAIL_RESERVE = 0.12;

/** Display tokens per line. A lone dash of a dialogue line is not a word. */
export function tokenizeLines(lines: string[]): string[][] {
  return lines.map((l) => l.split(/\s+/).filter((w) => w.length > 0 && w !== '-'));
}

function letterCount(word: string): number {
  return word.replace(/[^\p{L}\p{N}']/gu, '').length;
}

function pauseAfter(word: string): number {
  if (/[.?!…]["'”’)\]]*$/.test(word)) return 3;
  if (/[,;:—–]["'”’)\]]*$/.test(word)) return 1.5;
  return 0;
}

/**
 * Interpolated word timings: weight = max(2, len) plus a punctuation pause
 * (comma +1.5, sentence end +3 characters) that becomes a gap after the word.
 * The last 120 ms of the window carry no speech. Pure function.
 */
export function interpolateWords(start: number, end: number, lines: string[]): WordTiming[] {
  const words = tokenizeLines(lines).flat();
  if (words.length === 0) return [];

  const duration = Math.max(0, end - start);
  const speechEnd = Math.max(start + duration * 0.5, end - TAIL_RESERVE);
  const span = speechEnd - start;

  const weights = words.map((w) => Math.max(2, letterCount(w)));
  const pauses = words.map((w, i) => (i === words.length - 1 ? 0 : pauseAfter(w)));
  const total = weights.reduce((a, b) => a + b, 0) + pauses.reduce((a, b) => a + b, 0);

  const out: WordTiming[] = [];
  let acc = 0;
  for (let i = 0; i < words.length; i++) {
    const s = start + (acc / total) * span;
    acc += weights[i]!;
    const e = start + (acc / total) * span;
    acc += pauses[i]!;
    out.push({ text: words[i]!, start: s, end: e });
  }
  return out;
}

/** Real timings when the cue has them (ASR), otherwise interpolation. */
export function wordTimings(cue: Cue): WordTiming[] {
  return cue.words && cue.words.length > 0 ? cue.words : interpolateWords(cue.start, cue.end, cue.lines);
}

/** 0…1 fill progress of a word at time t. */
export function wordProgress(w: WordTiming, t: number): number {
  if (t <= w.start) return 0;
  if (t >= w.end) return 1;
  return (t - w.start) / (w.end - w.start);
}
