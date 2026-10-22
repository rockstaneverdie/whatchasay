import type { SubtitleEncoding } from '../core/subtitles/decode';
import type { MediaInfo } from '../core/subtitles/types';
import type { ExplainTarget } from './state.svelte';

/** What the UI may ask the content-script controller to do. */
export interface OverlayActions {
  /** Opens the file chooser; must be called from a user gesture. */
  pickFile(): void;
  loadFile(file: File): void;
  setEncoding(enc: SubtitleEncoding | 'auto'): void;
  seekToCue(index: number): void;
  togglePanel(): void;
  setCompact(mode: 'auto' | 'on' | 'off'): void;
  setPanelWidth(pct: number, persist: boolean): void;
  saveMediaInfo(info: MediaInfo): void;
  selectVideo(index: number): void;
  importPageTrack(index: number): void;
  nudgeOffset(deltaMs: number): void;
  openSettings(): void;
  dismissToast(): void;

  explain(target: ExplainTarget): void;
  closeCard(resume: boolean): void;
  explainMore(): void;
  refreshCard(): void;
  repeatCue(index: number): void;
  saveCard(): void;
  copyCard(): void;
  rateCard(value: 'up' | 'down'): void;
  retryCard(): void;
}
