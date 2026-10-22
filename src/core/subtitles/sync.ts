import type { RawCue } from './types';

export interface SyncResult {
  /** Seconds added after scaling: t' = t * scale + offset. */
  offset: number;
  scale: number;
  /** Share of target cues that start within the tolerance of a reference cue after the transform. */
  score: number;
  /** The same share without any transform, for comparison. */
  baseline: number;
}

/** Common frame-rate mismatches between releases (23.976 / 24 / 25 fps). */
export const SCALES = [1, 25 / 23.976, 23.976 / 25, 24 / 23.976, 23.976 / 24, 25 / 24, 24 / 25];

const TOLERANCE = 0.35;
const BIN = 0.1;

function lowerBound(a: Float64Array, x: number): number {
  let lo = 0;
  let hi = a.length;
  while (lo < hi) {
    const mid = (lo + hi) >> 1;
    if (a[mid]! < x) lo = mid + 1;
    else hi = mid;
  }
  return lo;
}

function matchScore(ref: Float64Array, tgt: number[], scale: number, offset: number): number {
  if (tgt.length === 0) return 0;
  let hit = 0;
  for (const t of tgt) {
    const x = t * scale + offset;
    const i = lowerBound(ref, x - TOLERANCE);
    if (i < ref.length && ref[i]! <= x + TOLERANCE) hit++;
  }
  return hit / tgt.length;
}

/**
 * FR-S7 autosync: finds the shift (and frame-rate scale) that best lines the target cue starts up
 * with a reference track — e.g. the page's own captions in any language, whose speech timing matches.
 * Histogram voting over pairwise start differences within ±maxShift, then refinement around the peak.
 */
export function estimateSync(referenceStarts: number[], targetStarts: number[], maxShift = 90): SyncResult {
  const ref = Float64Array.from([...referenceStarts].sort((a, b) => a - b));
  const tgt = [...targetStarts].sort((a, b) => a - b);
  const baseline = matchScore(ref, tgt, 1, 0);
  let best: SyncResult = { offset: 0, scale: 1, score: baseline, baseline };
  if (ref.length === 0 || tgt.length === 0) return best;

  for (const scale of SCALES) {
    const votes = new Map<number, number>();
    for (const t of tgt) {
      const x = t * scale;
      const from = lowerBound(ref, x - maxShift);
      for (let i = from; i < ref.length && ref[i]! <= x + maxShift; i++) {
        const bin = Math.round((ref[i]! - x) / BIN);
        votes.set(bin, (votes.get(bin) ?? 0) + 1);
      }
    }
    // Look at the strongest few bins; refine each to the mean difference of its close matches.
    const top = [...votes.entries()].sort((a, b) => b[1] - a[1]).slice(0, 5);
    for (const [bin] of top) {
      const center = bin * BIN;
      let sum = 0;
      let n = 0;
      for (const t of tgt) {
        const x = t * scale + center;
        const i = lowerBound(ref, x - TOLERANCE);
        if (i < ref.length && ref[i]! <= x + TOLERANCE) {
          sum += ref[i]! - x;
          n++;
        }
      }
      const offset = center + (n ? sum / n : 0);
      const score = matchScore(ref, tgt, scale, offset);
      if (score > best.score + 1e-9) best = { offset, scale, score, baseline };
    }
  }
  return best;
}

/** Applying only pays off when the match is clearly good and clearly better than doing nothing. */
export function isConfident(r: SyncResult): boolean {
  return r.score >= 0.45 && r.score >= r.baseline + 0.15;
}

export function applySync(cues: RawCue[], r: Pick<SyncResult, 'offset' | 'scale'>): RawCue[] {
  return cues.map((c) => ({
    ...c,
    start: Math.max(0, c.start * r.scale + r.offset),
    end: Math.max(0, c.end * r.scale + r.offset),
  }));
}
