/** TZ 7.3: opacity / scale / blur by distance from the active line. */
export interface LineLook {
  opacity: number;
  scale: number;
  blur: number;
}

export const NEIGHBOUR_RANGE = 6;
const IDLE_SCALE = 0.82;

export function lineLook(distance: number, reducedMotion: boolean): LineLook {
  const d = Math.abs(distance);
  let look: LineLook;
  if (d === 0) look = { opacity: 1, scale: 1, blur: 0 };
  else if (d === 1) look = { opacity: 0.5, scale: IDLE_SCALE, blur: 0.6 };
  else if (d === 2) look = { opacity: 0.35, scale: IDLE_SCALE, blur: 1.2 };
  else if (d <= NEIGHBOUR_RANGE) {
    const k = (d - 3) / (NEIGHBOUR_RANGE - 3);
    look = { opacity: 0.25 - 0.07 * k, scale: IDLE_SCALE, blur: 1.8 + 1.2 * k };
  } else look = { opacity: 0.12, scale: IDLE_SCALE, blur: 0 };
  // FR-P9: opacity only.
  if (reducedMotion) return { opacity: look.opacity, scale: 1, blur: 0 };
  return look;
}

export function lineStyle(distance: number, reducedMotion: boolean): string {
  const l = lineLook(distance, reducedMotion);
  const filter = l.blur > 0 ? `blur(${l.blur.toFixed(2)}px)` : 'none';
  return `--o:${l.opacity.toFixed(3)};--s:${l.scale};--f:${filter}`;
}

export function formatTime(t: number): string {
  const s = Math.max(0, Math.floor(t));
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  const sec = String(s % 60).padStart(2, '0');
  return h > 0 ? `${h}:${String(m).padStart(2, '0')}:${sec}` : `${m}:${sec}`;
}
