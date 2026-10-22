import { describe, expect, it } from 'vitest';
import { isEligible, type VideoInfo } from '../../src/core/player/find-video';

const base: VideoInfo = { width: 640, height: 360, visible: true, playing: false, decorative: false };

describe('isEligible', () => {
  it('accepts a visible, big enough video', () => {
    expect(isEligible(base)).toBe(true);
  });
  it('rejects small, hidden and decorative videos', () => {
    expect(isEligible({ ...base, width: 199 })).toBe(false);
    expect(isEligible({ ...base, height: 119 })).toBe(false);
    expect(isEligible({ ...base, visible: false })).toBe(false);
    expect(isEligible({ ...base, decorative: true })).toBe(false);
  });
});
