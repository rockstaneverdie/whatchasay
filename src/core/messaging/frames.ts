import type { PlayerState } from '../player/key-router';
import type { RemotePlayer } from './types';

/** Background registry of frames that own a video, per tab (FR-V5). Pure, unit-tested. */
export class FrameRegistry {
  private readonly tabs = new Map<number, Map<number, PlayerState>>();

  update(tabId: number, frameId: number, state: PlayerState): void {
    let frames = this.tabs.get(tabId);
    if (!frames) this.tabs.set(tabId, (frames = new Map()));
    if (state.hasVideo) frames.set(frameId, state);
    else frames.delete(frameId);
    if (frames.size === 0) this.tabs.delete(tabId);
  }

  /** The frame hotkeys go to: an open card first, then a loaded track, then any video. */
  best(tabId: number): RemotePlayer | null {
    const frames = this.tabs.get(tabId);
    if (!frames) return null;
    const score = (s: PlayerState) => (s.cardOpen ? 4 : 0) + (s.hasTrack ? 2 : 0) + (s.hasVideo ? 1 : 0);
    let best: RemotePlayer | null = null;
    for (const [frameId, s] of frames) {
      if (!best || score(s) > score(best) || (score(s) === score(best) && frameId < best.frameId)) {
        best = { ...s, frameId };
      }
    }
    return best;
  }

  /** For storage.session: the event page may be unloaded between messages. */
  dump(): [number, number, PlayerState][] {
    const out: [number, number, PlayerState][] = [];
    for (const [tabId, frames] of this.tabs) for (const [frameId, s] of frames) out.push([tabId, frameId, s]);
    return out;
  }

  restore(rows: unknown): void {
    if (!Array.isArray(rows)) return;
    for (const row of rows as [number, number, PlayerState][]) {
      if (Array.isArray(row) && typeof row[0] === 'number' && typeof row[1] === 'number' && row[2]) {
        this.update(row[0], row[1], row[2]);
      }
    }
  }

  forget(tabId: number, frameId?: number): void {
    if (frameId === undefined) this.tabs.delete(tabId);
    else this.update(tabId, frameId, { hasVideo: false, hasTrack: false, cardOpen: false });
  }
}
