import { describe, expect, it } from 'vitest';
import { CueIndex, subtitleTime } from '../../src/core/player/clock';
import type { Cue } from '../../src/core/subtitles/types';

const cue = (id: number, start: number, end: number): Cue => ({
  id,
  start,
  end,
  text: String(id),
  lines: [String(id)],
  kind: 'speech',
});

describe('CueIndex', () => {
  const idx = new CueIndex([cue(1, 1, 2), cue(2, 3, 4), cue(3, 3.5, 6), cue(4, 4, 4.5), cue(5, 10, 11)]);

  it('finds nothing before the first cue', () => {
    expect(idx.active(0.5)).toEqual([]);
    expect(idx.focusIndex(0.5)).toBe(-1);
  });

  it('uses [start, end) boundaries', () => {
    expect(idx.active(1)).toEqual([0]);
    expect(idx.active(1.999)).toEqual([0]);
    expect(idx.active(2)).toEqual([]);
  });

  it('returns all overlapping cues in order', () => {
    expect(idx.active(3.7)).toEqual([1, 2]);
    expect(idx.active(4.2)).toEqual([2, 3]);
    expect(idx.active(5)).toEqual([2]);
  });

  it('holds focus on the last started cue in gaps', () => {
    expect(idx.focusIndex(2.5)).toBe(0);
    expect(idx.focusIndex(8)).toBe(3);
    expect(idx.focusIndex(4.2)).toBe(3);
    expect(idx.focusIndex(100)).toBe(4);
  });

  it('agrees with a linear scan on a large random track', () => {
    const cues: Cue[] = [];
    let t = 0;
    for (let i = 0; i < 1000; i++) {
      t += Math.random() * 2;
      cues.push(cue(i + 1, t, t + 0.2 + Math.random() * 4));
    }
    const big = new CueIndex(cues);
    for (let k = 0; k < 500; k++) {
      const q = Math.random() * (t + 5);
      const expected = cues.flatMap((c, i) => (c.start <= q && q < c.end ? [i] : []));
      expect(big.active(q)).toEqual(expected);
    }
  });

  it('handles an empty track', () => {
    const empty = new CueIndex([]);
    expect(empty.active(1)).toEqual([]);
    expect(empty.focusIndex(1)).toBe(-1);
  });
});

describe('subtitleTime', () => {
  it('treats a positive offset as showing subtitles later', () => {
    expect(subtitleTime(10, 300)).toBeCloseTo(9.7);
    expect(subtitleTime(10, -1000)).toBeCloseTo(11);
  });
});
