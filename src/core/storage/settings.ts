import { DEFAULT_HOTKEYS, type HotkeyAction } from '../player/hotkeys';

export type Level = 'A2' | 'B1' | 'B2' | 'C1';
export type OutLang = 'en-simple' | 'ru';
export type ProviderId = 'gemini' | 'openai-compat';
export type UiLang = 'ru' | 'en';
export type Theme = 'auto' | 'dark' | 'light';

/** Everything here is non-secret and may be read by content scripts. Keys live in `secrets.ts`. */
export interface Settings {
  provider: ProviderId;
  gemini: { model: string };
  openai: { baseUrl: string; model: string };
  level: Level;
  outLang: OutLang;
  contextBudgetTokens: number;
  contextWindowCues: number;
  onlyPast: boolean;
  panel: {
    side: 'right' | 'left';
    /** Percent of the video width, 28…40. */
    widthPct: number;
    /** Multiplier of the base font size. */
    fontScale: number;
    compact: 'auto' | 'on' | 'off';
  };
  theme: Theme;
  hotkeys: Record<HotkeyAction, string>;
  uiLang: UiLang;
  cacheMaxMB: number;
  /** M4 subtitle sources. */
  sources: {
    /** OpenSubtitles language codes, comma separated (e.g. "en" or "en,pt-br"). */
    osLanguages: string;
    /** Normally the official API; tests point it at a local mock. */
    osBaseUrl: string;
    /** Align downloaded subtitles to the page's own track when one is available. */
    autoSync: boolean;
  };
}

/** Checked against ai.google.dev/gemini-api/docs/models on 2026-10-22 (see docs/decisions.md, D-007). */
export const DEFAULT_GEMINI_MODEL = 'gemini-3.8-flash';

export const DEFAULT_SETTINGS: Settings = {
  provider: 'gemini',
  gemini: { model: DEFAULT_GEMINI_MODEL },
  openai: { baseUrl: 'https://api.groq.com/openai/v1', model: '' },
  level: 'B1',
  outLang: 'ru',
  contextBudgetTokens: 40_000,
  contextWindowCues: 150,
  onlyPast: false,
  panel: { side: 'right', widthPct: 34, fontScale: 1, compact: 'auto' },
  theme: 'auto',
  hotkeys: { ...DEFAULT_HOTKEYS },
  uiLang: 'ru',
  cacheMaxMB: 20,
  sources: {
    osLanguages: 'en',
    osBaseUrl: 'https://api.opensubtitles.com/api/v1',
    autoSync: true,
  },
};

export const SETTINGS_KEY = 'settings';

type DeepPartial<T> = { [K in keyof T]?: T[K] extends object ? DeepPartial<T[K]> : T[K] };
export type SettingsPatch = DeepPartial<Settings>;

/** One level of nesting is enough for this shape. */
export function mergeSettings(base: Settings, patch: SettingsPatch | undefined): Settings {
  if (!patch) return structuredClone(base);
  const out = structuredClone(base) as unknown as Record<string, unknown>;
  for (const [k, v] of Object.entries(patch)) {
    if (v === undefined) continue;
    const cur = out[k];
    out[k] =
      cur && typeof cur === 'object' && !Array.isArray(cur) && typeof v === 'object'
        ? { ...(cur as object), ...(v as object) }
        : v;
  }
  return out as unknown as Settings;
}

export function clampSettings(s: Settings): Settings {
  s.panel.widthPct = Math.min(40, Math.max(28, s.panel.widthPct));
  s.panel.fontScale = Math.min(1.6, Math.max(0.7, s.panel.fontScale));
  s.contextBudgetTokens = Math.max(2_000, Math.round(s.contextBudgetTokens));
  s.contextWindowCues = Math.max(10, Math.round(s.contextWindowCues));
  s.cacheMaxMB = Math.max(1, s.cacheMaxMB);
  return s;
}

export async function loadSettings(): Promise<Settings> {
  const stored = (await browser.storage.local.get(SETTINGS_KEY))[SETTINGS_KEY] as SettingsPatch | undefined;
  return clampSettings(mergeSettings(DEFAULT_SETTINGS, stored));
}

export async function saveSettings(patch: SettingsPatch): Promise<Settings> {
  const next = clampSettings(mergeSettings(await loadSettings(), patch));
  await browser.storage.local.set({ [SETTINGS_KEY]: next });
  return next;
}

export function onSettingsChanged(cb: (s: Settings) => void): () => void {
  const listener = (changes: Record<string, { newValue?: unknown }>, area: string) => {
    if (area !== 'local' || !changes[SETTINGS_KEY]) return;
    cb(clampSettings(mergeSettings(DEFAULT_SETTINGS, changes[SETTINGS_KEY].newValue as SettingsPatch)));
  };
  browser.storage.onChanged.addListener(listener);
  return () => browser.storage.onChanged.removeListener(listener);
}
