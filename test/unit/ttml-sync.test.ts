import { describe, expect, it } from 'vitest';
import { parseSubtitles } from '../../src/core/subtitles/parse';
import { parseTtml, parseTtmlTime } from '../../src/core/subtitles/parse-ttml';
import { applySync, estimateSync, isConfident } from '../../src/core/subtitles/sync';

describe('parseTtmlTime', () => {
  it.each([
    ['00:00:01.500', 1.5],
    ['01:02:03', 3723],
    ['00:00:01:15', 1.5],
    ['2.5s', 2.5],
    ['1500ms', 1.5],
    ['3m', 180],
    ['45f', 1.5],
  ])('%s', (v, t) => expect(parseTtmlTime(v, 30)).toBeCloseTo(t, 6));

  it('uses the tick rate for ticks and rejects junk', () => {
    expect(parseTtmlTime('10000000t', 30, 10_000_000)).toBe(1);
    expect(parseTtmlTime('soon')).toBeNull();
  });
});

const TTML = `<?xml version="1.0" encoding="utf-8"?>
<!-- invented sample -->
<tt xmlns="http://www.w3.org/ns/ttml" xmlns:ttp="http://www.w3.org/ns/ttml#parameter" ttp:tickRate="10000000">
  <body><div begin="1s">
    <p begin="0s" end="2s">Who moved my <span style="i">bicycle</span>?</p>
    <p begin="25000000t" dur="15000000t">Not me.<br/>I was asleep.</p>
    <p begin="00:00:06.000" end="00:00:07.000">   </p>
  </div></body>
</tt>`;

describe('parseTtml', () => {
  it('reads paragraphs, spans, line breaks, ticks, dur and inherited begin', () => {
    expect(parseTtml(TTML)).toEqual([
      { start: 1, end: 3, text: 'Who moved my bicycle?' },
      { start: 3.5, end: 5, text: 'Not me.\nI was asleep.' },
    ]);
  });

  it('is detected by parseSubtitles', () => {
    expect(parseSubtitles(TTML).format).toBe('ttml');
    expect(
      parseSubtitles('<tt xmlns="http://www.w3.org/ns/ttml"><body><p begin="1s" end="2s">x</p></body></tt>')
        .cues,
    ).toHaveLength(1);
  });

  it('returns nothing for broken XML', () => {
    expect(parseTtml('<tt><p begin="1s"')).toEqual([]);
  });
});

function starts(n: number, seed = 7): number[] {
  // Irregular, speech-like gaps; deterministic.
  let x = seed;
  let t = 5;
  const out: number[] = [];
  for (let i = 0; i < n; i++) {
    x = (x * 1103515245 + 12345) % 2147483648;
    t += 0.8 + (x / 2147483648) * 4;
    out.push(t);
  }
  return out;
}

describe('estimateSync', () => {
  const ref = starts(400);

  it('finds a constant shift', () => {
    const tgt = ref.map((t) => t - 2.3);
    const r = estimateSync(ref, tgt);
    expect(r.scale).toBe(1);
    expect(r.offset).toBeCloseTo(2.3, 1);
    expect(r.score).toBeGreaterThan(0.95);
    expect(isConfident(r)).toBe(true);
  });

  it('finds a frame-rate mismatch plus shift', () => {
    const tgt = ref.map((t) => (t - 1.2) / (25 / 23.976));
    const r = estimateSync(ref, tgt);
    expect(r.scale).toBeCloseTo(25 / 23.976, 6);
    expect(r.offset).toBeCloseTo(1.2, 1);
    expect(r.score).toBeGreaterThan(0.9);
  });

  it('copes with a translation that splits and merges lines (partial overlap)', () => {
    const tgt = ref.filter((_, i) => i % 3 !== 0).map((t) => t + 4.1);
    const r = estimateSync(ref, tgt);
    expect(r.offset).toBeCloseTo(-4.1, 1);
    expect(isConfident(r)).toBe(true);
  });

  it('is not confident about unrelated tracks', () => {
    const r = estimateSync(ref, starts(300, 99));
    expect(isConfident(r)).toBe(false);
  });

  it('leaves aligned tracks alone', () => {
    const r = estimateSync(ref, ref);
    expect(r.offset).toBeCloseTo(0, 1);
    expect(isConfident(r)).toBe(false); // nothing to improve
  });
});

describe('applySync', () => {
  it('scales and shifts, never below zero', () => {
    expect(applySync([{ start: 1, end: 2, text: 'a' }], { offset: -1.5, scale: 2 })).toEqual([
      { start: 0.5, end: 2.5, text: 'a' },
    ]);
    expect(applySync([{ start: 1, end: 2, text: 'a' }], { offset: -5, scale: 1 })[0]!.start).toBe(0);
  });
});
