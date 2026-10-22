export type HotkeyAction = 'togglePanel' | 'explain' | 'repeat' | 'offsetBack' | 'offsetForward';

/** `KeyboardEvent.code` based, so they work on any keyboard layout (e.g. Russian). */
export const DEFAULT_HOTKEYS: Record<HotkeyAction, string> = {
  togglePanel: 'Alt+KeyL',
  explain: 'KeyE',
  repeat: 'KeyR',
  offsetBack: 'BracketLeft',
  offsetForward: 'BracketRight',
};

export interface KeyLike {
  code: string;
  altKey: boolean;
  ctrlKey: boolean;
  shiftKey: boolean;
  metaKey: boolean;
}

interface Parsed {
  code: string;
  alt: boolean;
  ctrl: boolean;
  shift: boolean;
  meta: boolean;
}

export function parseHotkey(spec: string): Parsed {
  const parts = spec.split('+').map((p) => p.trim());
  const code = parts.pop() ?? '';
  const mods = new Set(parts.map((p) => p.toLowerCase()));
  return {
    code,
    alt: mods.has('alt'),
    ctrl: mods.has('ctrl'),
    shift: mods.has('shift'),
    meta: mods.has('meta'),
  };
}

/** `ignoreShift`: Shift is a modifier of the action itself (offset ±1 s). */
export function matchHotkey(e: KeyLike, spec: string, ignoreShift = false): boolean {
  const p = parseHotkey(spec);
  return (
    e.code === p.code &&
    e.altKey === p.alt &&
    e.ctrlKey === p.ctrl &&
    e.metaKey === p.meta &&
    (ignoreShift || e.shiftKey === p.shift)
  );
}

const MODIFIER_CODES = /^(Shift|Control|Alt|Meta|OS)(Left|Right)?$/;

/** For the options page: the spec of a pressed combination, or null while only modifiers are down. */
export function hotkeyFromEvent(e: KeyLike): string | null {
  if (MODIFIER_CODES.test(e.code)) return null;
  const mods = [e.ctrlKey && 'Ctrl', e.altKey && 'Alt', e.shiftKey && 'Shift', e.metaKey && 'Meta'].filter(
    Boolean,
  );
  return [...mods, e.code].join('+');
}

/** Human label: `Alt+KeyL` → `Alt+L`, `BracketLeft` → `[`. */
export function formatHotkey(spec: string): string {
  const names: Record<string, string> = {
    BracketLeft: '[',
    BracketRight: ']',
    Space: 'Space',
    Escape: 'Esc',
    Comma: ',',
    Period: '.',
    Slash: '/',
    Semicolon: ';',
    Quote: "'",
    Backquote: '`',
    Minus: '-',
    Equal: '=',
  };
  return spec
    .split('+')
    .map((p) => names[p] ?? p.replace(/^Key/, '').replace(/^Digit/, ''))
    .join('+');
}

const TEXT_INPUT_TYPES = new Set(['text', 'search', 'email', 'url', 'tel', 'password', 'number', '']);

/** Hotkeys are ignored while the user types (also inside shadow DOM). */
export function isEditableTarget(e: Event): boolean {
  const target = (e.composedPath?.()[0] ?? e.target) as Element | null;
  if (!target || !(target instanceof Element)) return false;
  const el = target as HTMLElement;
  if (el.isContentEditable) return true;
  const tag = el.tagName;
  if (tag === 'TEXTAREA' || tag === 'SELECT') return true;
  if (tag === 'INPUT') return TEXT_INPUT_TYPES.has((el as HTMLInputElement).type);
  return false;
}
