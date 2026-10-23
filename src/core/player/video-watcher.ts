import { findVideos, rankVideos } from './find-video';

/**
 * FR-V1/V2/V6: keeps a ranked list of eligible videos up to date while the site adds, removes or
 * swaps <video> elements (SPA navigation), including inside open shadow roots, which a
 * document-level MutationObserver and media-event listener cannot see into.
 */
export class VideoWatcher {
  private observer: MutationObserver;
  private timer: ReturnType<typeof setTimeout> | undefined;
  private interval: ReturnType<typeof setInterval>;
  private last: HTMLVideoElement[] = [];
  /** A play event must reach onChange even when the ranking did not change (see check). */
  private forceNext = false;
  private readonly watchedRoots = new Set<Document | ShadowRoot>();

  constructor(
    private readonly doc: Document,
    private readonly onChange: (ranked: HTMLVideoElement[]) => void,
  ) {
    this.observer = new MutationObserver((records) => {
      const touchesVideo = records.some((r) =>
        [...r.addedNodes, ...r.removedNodes].some(
          (n) =>
            n.nodeName === 'VIDEO' ||
            (n instanceof Element &&
              (!!n.querySelector('video') || !!n.shadowRoot || n.tagName.includes('-'))),
        ),
      );
      if (touchesVideo) this.schedule(50);
    });
    this.watch(doc);
    // Layout changes (a player growing from a thumbnail) and late shadow roots have no event of their own.
    this.interval = setInterval(() => this.schedule(0), 2000);
    this.schedule(0);
  }

  private watch(root: Document | ShadowRoot) {
    if (this.watchedRoots.has(root)) return;
    this.watchedRoots.add(root);
    const target = root instanceof Document ? root.documentElement : root;
    if (target) this.observer.observe(target, { childList: true, subtree: true });
    // A video that starts playing may become the best candidate. Media events neither bubble nor
    // leave a shadow tree, so each root gets its own capturing listener.
    root.addEventListener('play', this.onPlay, true);
    root.addEventListener('loadedmetadata', this.onPlay, true);
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
    const roots: ShadowRoot[] = [];
    const ranked = rankVideos(findVideos(this.doc, roots));
    for (const r of roots) this.watch(r);
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
    for (const root of this.watchedRoots) {
      root.removeEventListener('play', this.onPlay, true);
      root.removeEventListener('loadedmetadata', this.onPlay, true);
    }
    this.watchedRoots.clear();
  }
}
