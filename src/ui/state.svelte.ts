import type {
  Confidence,
  ExplainMode,
  ExplainResult,
  ExplainType,
  ProviderErrorCode,
} from '../core/ai/types';
import { DEFAULT_SETTINGS, type Settings } from '../core/storage/settings';
import type { SubtitleEncoding } from '../core/subtitles/decode';
import type { MediaInfo, Track } from '../core/subtitles/types';
import { translate, type MessageKey } from '../i18n';

export interface Toast {
  id: number;
  text: string;
  action?: { label: string; run: () => void };
}

export interface ExplainTarget {
  cueIndex: number;
  focusText?: string;
  /** Element the card points at (a line or a word). */
  anchorEl?: Element;
  /** Viewport rect for selections (captured at click time). */
  anchorRect?: DOMRect;
}

export interface CardState {
  reqId: number;
  target: ExplainTarget;
  cueId: number;
  mode: ExplainMode;
  status: 'loading' | 'streaming' | 'done' | 'error';
  text: string;
  type?: ExplainType;
  confidence?: Confidence;
  expr?: string;
  result?: ExplainResult;
  cached: boolean;
  cacheKey?: string;
  error?: { code: ProviderErrorCode | 'unknown'; message: string; retryAfter?: number };
  retryInSec?: number;
  feedback?: 'up' | 'down';
  saved?: boolean;
}

export interface VideoChoice {
  index: number;
  width: number;
  height: number;
  current: boolean;
}

export interface PageTrackChoice {
  index: number;
  label: string;
  lang?: string;
}

/** All reactive UI state. Large data uses $state.raw (no deep proxies; 1 000 cues stay cheap). */
export class OverlayState {
  settings = $state<Settings>(structuredClone(DEFAULT_SETTINGS));
  track = $state.raw<Track | null>(null);
  offsetMs = $state(0);
  /** Subtitle clock (seconds, offset applied). Updated every frame only while playing. */
  time = $state(0);
  /** Index of the cue the panel centres on; -1 before the first cue. */
  focus = $state(-1);
  active = $state.raw<number[]>([]);
  playing = $state(false);

  panelVisible = $state(false);
  launcherVisible = $state(false);
  menuOpen = $state(false);
  mediaFormOpen = $state(false);
  mediaInfo = $state<MediaInfo>({});
  dragOver = $state(false);
  toast = $state<Toast | null>(null);
  card = $state<CardState | null>(null);
  box = $state({ width: 0, height: 0 });
  videos = $state.raw<VideoChoice[]>([]);
  pageTracks = $state.raw<PageTrackChoice[]>([]);
  encoding = $state<SubtitleEncoding | 'auto'>('auto');
  hasFile = $state(false);
  reducedMotion = $state(false);
  systemDark = $state(true);

  readonly theme = $derived(
    this.settings.theme === 'auto' ? (this.systemDark ? 'dark' : 'light') : this.settings.theme,
  );

  /** FR-P8 / 7.7: compact when asked to, or when the side panel would be narrower than 320 px. */
  readonly compact = $derived(
    this.settings.panel.compact === 'on' ||
      (this.settings.panel.compact === 'auto' &&
        this.box.width > 0 &&
        (this.box.width * this.settings.panel.widthPct) / 100 < 320),
  );

  t = (key: MessageKey, params?: Record<string, string | number>) =>
    translate(this.settings.uiLang, key, params);
}
