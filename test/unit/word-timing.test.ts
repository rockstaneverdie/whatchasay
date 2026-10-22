import { describe, expect, it } from 'vitest';
import {
  interpolateWords,
  TAIL_RESERVE,
  tokenizeLines,
  wordProgress,
  wordTimings,
} from '../../src/core/subtitles/word-timing';

describe('tokenizeLines', () => {
  it('splits on whitespace and drops dialogue dashes', () => {
    expect(tokenizeLines(['- Did it work?', '- Define  "work".'])).toEqual([
      ['Did', 'it', 'work?'],
      ['Define', '"work".'],
    ]);
  });
});

describe('interpolateWords', () => {
  it('returns nothing for an empty cue', () => {
    expect(interpolateWords(0, 1, [''])).toEqual([]);
  });

  it('is monotonic, starts at the cue start and leaves the last 120 ms free', () => {
    const w = interpolateWords(10, 13, ['Well, I suppose we could try it again.']);
    expect(w[0]!.start).toBe(10);
    expect(w[w.length - 1]!.end).toBeCloseTo(13 - TAIL_RESERVE, 9);
    for (let i = 0; i < w.length; i++) {
      expect(w[i]!.end).toBeGreaterThan(w[i]!.start);
      if (i > 0) expect(w[i]!.start).toBeGreaterThanOrEqual(w[i - 1]!.end);
    }
  });

  it('weights words by length with a floor of 2', () => {
    const [a, b] = interpolateWords(0, 1.12, ['I extraordinarily']);
    // weights 2 and 15 over 1.0 s of speech
    expect(a!.end - a!.start).toBeCloseTo(2 / 17, 6);
    expect(b!.end - b!.start).toBeCloseTo(15 / 17, 6);
  });

  it('inserts punctuation pauses after commas and sentence ends', () => {
    // "ab, cd. ef" → weights 2,2,2 ; pauses 1.5, 3 → total 10.5 over 1 s
    const [a, b, c] = interpolateWords(0, 1.12, ['ab, cd. ef']);
    expect(a!.end).toBeCloseTo(2 / 10.5, 6);
    expect(b!.start).toBeCloseTo(3.5 / 10.5, 6);
    expect(b!.end).toBeCloseTo(5.5 / 10.5, 6);
    expect(c!.start).toBeCloseTo(8.5 / 10.5, 6);
  });

  it('never squeezes speech below half of a very short cue', () => {
    const w = interpolateWords(0, 0.1, ['Hi']);
    expect(w[0]!.end).toBeCloseTo(0.05, 6);
  });

  it('prefers real word timings', () => {
    const words = [{ text: 'Hi', start: 0.3, end: 0.4 }];
    expect(wordTimings({ id: 1, start: 0, end: 1, text: 'Hi', lines: ['Hi'], kind: 'speech', words })).toBe(
      words,
    );
  });
});

describe('wordProgress', () => {
  it('clamps to 0…1', () => {
    const w = { text: 'x', start: 1, end: 2 };
    expect(wordProgress(w, 0.5)).toBe(0);
    expect(wordProgress(w, 1.5)).toBe(0.5);
    expect(wordProgress(w, 3)).toBe(1);
  });
});
