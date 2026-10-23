import { matchHotkey, type HotkeyAction, type KeyLike } from './hotkeys';

/** What the frame that owns the active video looks like, locally or as reported to other frames (FR-V5). */
export interface PlayerState {
  hasVideo: boolean;
  hasTrack: boolean;
  cardOpen: boolean;
}

export interface KeyContext extends PlayerState {
  /** Our own dialogs or menu (only in the frame that shows them). */
  dialogOpen: boolean;
  editable: boolean;
  hotkeys: Record<HotkeyAction, string>;
}

export type KeyAction =
  | { kind: 'close-dialogs' }
  | { kind: 'card-resume' }
  | { kind: 'card-close' }
  | { kind: 'toggle-panel' }
  | { kind: 'explain' }
  | { kind: 'repeat' }
  | { kind: 'offset'; deltaMs: number };

export type RoutedKey = KeyLike & { repeat?: boolean };

/**
 * FR-I4 / FR-V8: which of our actions a key press means, or null to leave it to the page.
 * Our hotkeys act only with a track loaded (Alt+L excepted) so the site's player keeps its keys.
 * `repeat` presses of one-shot actions are swallowed without acting.
 */
export function routeKey(k: RoutedKey, c: KeyContext): { action: KeyAction | null; swallow: boolean } | null {
  if (!c.hasVideo) return null;
  const plain = !k.altKey && !k.ctrlKey && !k.metaKey && !k.shiftKey;
  if (k.code === 'Escape' && !c.cardOpen && c.dialogOpen)
    return { action: { kind: 'close-dialogs' }, swallow: true };
  if (c.cardOpen && !c.editable) {
    if (k.code === 'Space' && plain) return { action: { kind: 'card-resume' }, swallow: true };
    if (k.code === 'Escape') return { action: { kind: 'card-close' }, swallow: true };
  }
  if (c.editable) return null;
  const hk = c.hotkeys;
  if (matchHotkey(k, hk.togglePanel)) return { action: { kind: 'toggle-panel' }, swallow: true };
  if (!c.hasTrack) return null;
  if (matchHotkey(k, hk.explain)) return { action: k.repeat ? null : { kind: 'explain' }, swallow: true };
  if (matchHotkey(k, hk.repeat)) return { action: k.repeat ? null : { kind: 'repeat' }, swallow: true };
  if (matchHotkey(k, hk.offsetBack, true)) {
    return { action: { kind: 'offset', deltaMs: k.shiftKey ? -1000 : -100 }, swallow: true };
  }
  if (matchHotkey(k, hk.offsetForward, true)) {
    return { action: { kind: 'offset', deltaMs: k.shiftKey ? 1000 : 100 }, swallow: true };
  }
  return null;
}

/** FR-V9: a big duration change while playback restarts near zero means another episode in the same element. */
export function durationSuggestsNewMedia(
  prev: number,
  next: number,
  currentTime: number,
  prevStableForMs: number,
): boolean {
  if (!Number.isFinite(prev) || !Number.isFinite(next) || prev <= 0 || next <= 30) return false;
  if (prevStableForMs < 10_000) return false; // still loading / growing
  if (currentTime > 5) return false;
  return Math.abs(next - prev) / prev > 0.05;
}
