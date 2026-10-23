import { findVideos, rankVideos } from './find-video';

/**
 * FR-V1/V2: keeps a ranked list of eligible videos up to date while the site
 * adds, removes or swaps <video> elements (SPA navigation).
 */
export class VideoWatcher {
  private observer: MutationObserver;
  private timer: ReturnType<typeof setTimeout> | undefined;
  private interval: ReturnType<typeof setInterval>;
  private last: HTMLVideoElement[] = [];
  /** A play event must reach onChange even when the ranking did not change (see check). */
  private forceNext = false;

  constructor(
    private readonly doc: Document,
    private readonly onChange: (ranked: HTMLVideoElement[]) => void,
  ) {
    this.observer = new MutationObserver((records) => {
      const touchesVideo = records.some((r) =>
        [...r.addedNodes, ...r.removedNodes].some(
          (n) => n.nodeName === 'VIDEO' || (n instanceof Element && n.querySelector('video')),
        ),
      );
      if (touchesVideo) this.schedule(50);
    });
    this.observer.observe(doc.documentElement, { childList: true, subtree: true });
    // A video that starts playing may become the best candidate (media events don't bubble).
    doc.addEventListener('play', this.onPlay, true);
    doc.addEventListener('loadedmetadata', this.onPlay, true);
    // Layout changes (a player growing from a thumbnail) have no event of their own.
    this.interval = setInterval(() => this.schedule(0), 2000);
    this.schedule(0);
  }

  private onPlay = (e: Event) => {
    if (!(e.target instanceof HTMLVideoElement)) return;
    // A player that was inserted paused and starts later keeps its rank, but the choice of
    // "the video being watched" depends on who is playing — so let the owner decide again.
    if (e.type === 'play') this.forceNext = true;
    this.schedule(0);
  };

  private schedule(delay: number) {
    if (this.timer !== undefined) return;
    this.timer = setTimeout(() => {
      this.timer = undefined;
      this.check();
    }, delay);
  }

  check(): void {
    const ranked = rankVideos(findVideos(this.doc));
    const same = ranked.length === this.last.length && ranked.every((v, i) => v === this.last[i]);
    const force = this.forceNext;
    this.forceNext = false;
    if (same && !force) return;
    this.last = ranked;
    this.onChange(ranked);
  }

  get videos(): readonly HTMLVideoElement[] {
    return this.last;
  }

  destroy(): void {
    this.observer.disconnect();
    clearInterval(this.interval);
    clearTimeout(this.timer);
    this.doc.removeEventListener('play', this.onPlay, true);
    this.doc.removeEventListener('loadedmetadata', this.onPlay, true);
  }
}
