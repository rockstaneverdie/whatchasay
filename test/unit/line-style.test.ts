import { describe, expect, it } from 'vitest';
import { formatTime, lineLook, lineStyle } from '../../src/ui/line-style';

describe('lineLook (TZ 7.3)', () => {
  it('follows the distance table', () => {
    expect(lineLook(0, false)).toEqual({ opacity: 1, scale: 1, blur: 0 });
    expect(lineLook(-1, false)).toEqual({ opacity: 0.5, scale: 0.82, blur: 0.6 });
    expect(lineLook(2, false)).toEqual({ opacity: 0.35, scale: 0.82, blur: 1.2 });
    expect(lineLook(3, false).opacity).toBeCloseTo(0.25);
    expect(lineLook(6, false).opacity).toBeCloseTo(0.18);
    expect(lineLook(6, false).blur).toBeCloseTo(3);
    expect(lineLook(7, false)).toEqual({ opacity: 0.12, scale: 0.82, blur: 0 });
  });

  it('blurs only the active line and its ±6 neighbours', () => {
    for (let d = -6; d <= 6; d++) if (d !== 0) expect(lineLook(d, false).blur).toBeGreaterThan(0);
    expect(lineLook(-7, false).blur).toBe(0);
    expect(lineLook(40, false).blur).toBe(0);
  });

  it('uses opacity only with reduced motion', () => {
    expect(lineLook(2, true)).toEqual({ opacity: 0.35, scale: 1, blur: 0 });
    expect(lineStyle(2, true)).toContain('--f:none');
  });
});

describe('formatTime', () => {
  it('formats minutes and hours', () => {
    expect(formatTime(5.9)).toBe('0:05');
    expect(formatTime(125)).toBe('2:05');
    expect(formatTime(3725)).toBe('1:02:05');
  });
});
