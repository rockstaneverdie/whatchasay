import type { Cue } from '../subtitles/types';

/**
 * Active-cue lookup over cues sorted by start. Overlapping cues are allowed:
 * a prefix maximum of `end` bounds how far back the scan has to look.
 */
export class CueIndex {
  private readonly starts: Float64Array;
  private readonly prefixMaxEnd: Float64Array;

  constructor(readonly cues: readonly Cue[]) {
    this.starts = new Float64Array(cues.length);
    this.prefixMaxEnd = new Float64Array(cues.length);
    let maxEnd = -Infinity;
    cues.forEach((c, i) => {
      this.starts[i] = c.start;
      maxEnd = Math.max(maxEnd, c.end);
      this.prefixMaxEnd[i] = maxEnd;
    });
  }

  /** Index of the last cue with start <= t, or -1. */
  lastStartedIndex(t: number): number {
    let lo = 0;
    let hi = this.starts.length - 1;
    let ans = -1;
    while (lo <= hi) {
      const mid = (lo + hi) >> 1;
      if (this.starts[mid]! <= t) {
        ans = mid;
        lo = mid + 1;
      } else {
        hi = mid - 1;
      }
    }
    return ans;
  }

  /** Indices of all cues with start <= t < end, ascending. */
  active(t: number): number[] {
    const out: number[] = [];
    for (let i = this.lastStartedIndex(t); i >= 0 && this.prefixMaxEnd[i]! > t; i--) {
      if (this.cues[i]!.end > t) out.push(i);
    }
    return out.reverse();
  }

  /**
   * The cue the panel centres on: the latest active cue, otherwise the last cue
   * that has already started (so the panel holds still in gaps), otherwise -1.
   */
  focusIndex(t: number): number {
    const act = this.active(t);
    if (act.length > 0) return act[act.length - 1]!;
    return this.lastStartedIndex(t);
  }
}

/** Offset is a display shift: +300 ms shows every cue 300 ms later. */
export function subtitleTime(currentTime: number, offsetMs: number): number {
  return currentTime - offsetMs / 1000;
}
