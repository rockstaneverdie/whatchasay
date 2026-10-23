import baseCss from './styles/base.css?inline';
import tokensCss from './styles/tokens.css?inline';
import { composedAncestors, composedContains, elementAtPoint, fullscreenElementFor } from '../utils/dom';

const HOST_TAG = 'subtext-overlay';

/** Events that must not reach the site's player through our UI (e.g. click-to-pause). */
const ISOLATED_EVENTS = [
  'click',
  'dblclick',
  'mousedown',
  'mouseup',
  'pointerdown',
  'pointerup',
  'contextmenu',
  'wheel',
  'touchstart',
  'touchend',
  'keydown',
  'keyup',
  'keypress',
] as const;

/**
 * NFR-5 / FR-V3: a shadow root that lives inside the player container, covers the video box
 * and lets clicks through except on our own controls.
 */
export class OverlayHost {
  readonly host: HTMLElement;
  readonly shadow: ShadowRoot;
  readonly root: HTMLDivElement;
  readonly fileInput: HTMLInputElement;
  private home: HTMLElement | null = null;

  constructor(
    private readonly video: HTMLVideoElement,
    onFile: (file: File) => void,
  ) {
    this.host = document.createElement(HOST_TAG);
    this.shadow = this.host.attachShadow({ mode: 'open' });
    const style = document.createElement('style');
    style.textContent = `${tokensCss}\n${baseCss}`;
    this.root = document.createElement('div');
    this.root.className = 'root';
    this.fileInput = document.createElement('input');
    this.fileInput.type = 'file';
    this.fileInput.accept = '.srt,.vtt,text/vtt,application/x-subrip';
    this.fileInput.className = 'sr-only';
    this.fileInput.tabIndex = -1;
    this.fileInput.setAttribute('aria-hidden', 'true');
    this.fileInput.addEventListener('change', () => {
      const file = this.fileInput.files?.[0];
      if (file) onFile(file);
      this.fileInput.value = '';
    });
    this.root.append(this.fileInput);
    this.shadow.append(style, this.root);
    for (const type of ISOLATED_EVENTS) {
      this.host.addEventListener(type, (e) => e.stopPropagation());
    }
    this.setStyle({
      position: 'absolute',
      display: 'block',
      margin: '0',
      padding: '0',
      border: '0',
      'z-index': '2147483647',
      'pointer-events': 'none',
      overflow: 'visible',
      transform: 'none',
      opacity: '1',
      visibility: 'visible',
    });
  }

  private setStyle(props: Record<string, string>) {
    for (const [k, v] of Object.entries(props)) this.host.style.setProperty(k, v, 'important');
  }

  /** FR-V7: an ancestor the host was lifted to, so it sits above the player's own layers. */
  private preferred: HTMLElement | null = null;

  private container(): HTMLElement | null {
    return this.preferred ?? this.video.parentElement;
  }

  /** The element the host should live in: the player container, or the fullscreen element (FR-V3, FR-V6). */
  private targetParent(): HTMLElement | null {
    const container = this.container();
    const fs = fullscreenElementFor(this.video) as HTMLElement | null;
    if (
      fs &&
      fs !== this.video &&
      composedContains(fs, this.video) &&
      container &&
      !composedContains(fs, container)
    ) {
      return fs;
    }
    return container;
  }

  attach(): void {
    const parent = this.targetParent();
    if (!parent) return;
    this.home = parent;
    if (this.host.parentElement !== parent) parent.appendChild(this.host);
    this.position();
  }

  /** Re-parent on fullscreen changes and keep the box glued to the video. Returns the box size. */
  position(): { width: number; height: number } {
    const parent = this.targetParent();
    if (parent && parent !== this.home) {
      this.home = parent;
      parent.appendChild(this.host);
    }
    const vr = this.video.getBoundingClientRect();
    const op = this.host.offsetParent as HTMLElement | null;
    let left = vr.left;
    let top = vr.top;
    const staticBody = !op || (op === document.body && getComputedStyle(document.body).position === 'static');
    if (staticBody) {
      left += window.scrollX;
      top += window.scrollY;
    } else {
      const r = op.getBoundingClientRect();
      left -= r.left + op.clientLeft - op.scrollLeft;
      top -= r.top + op.clientTop - op.scrollTop;
    }
    this.setStyle({
      left: `${Math.round(left)}px`,
      top: `${Math.round(top)}px`,
      width: `${Math.round(vr.width)}px`,
      height: `${Math.round(vr.height)}px`,
    });
    return { width: vr.width, height: vr.height };
  }

  /**
   * FR-V7: players often lay transparent click catchers or controls over the <video> in their own
   * stacking context, which would cover a host that lives next to the video. Hit-test where our
   * launcher and panel sit; if something else is on top, move the host up to the closest ancestor
   * shared with that layer — but never beyond the player box (a page-wide modal must stay on top).
   * Returns true when the host moved.
   */
  ensureOnTop(): boolean {
    const vr = this.video.getBoundingClientRect();
    if (vr.width < 50 || vr.height < 50 || this.videoItselfFullscreen) return false;
    const points: [number, number][] = [
      [vr.left + 30, vr.top + 30],
      [vr.right - Math.min(60, vr.width * 0.1), vr.top + vr.height * 0.4],
    ];
    let moved = false;
    this.setStyle({ 'pointer-events': 'auto' });
    try {
      for (let step = 0; step < 4; step++) {
        let blocker: Element | null = null;
        for (const [x, y] of points) {
          const el = elementAtPoint(this.host, x, y);
          if (el && el !== this.host && !composedContains(this.host, el)) {
            blocker = el;
            break;
          }
        }
        const parent = this.host.parentElement;
        if (!blocker || !parent) return moved;
        const lca = [parent, ...composedAncestors(parent)].find((a) => composedContains(a, blocker));
        if (!lca || lca === parent || lca === document.body || lca === document.documentElement) return moved;
        const lr = lca.getBoundingClientRect();
        if (lr.width > vr.width * 1.5 + 40 || lr.height > vr.height * 1.6 + 80) return moved;
        this.preferred = lca as HTMLElement;
        this.home = this.preferred;
        this.preferred.appendChild(this.host);
        this.position();
        moved = true;
      }
      return moved;
    } finally {
      this.setStyle({ 'pointer-events': 'none' });
    }
  }

  /** Fullscreen on the bare <video> element hides everything else; nothing we can do there. */
  get videoItselfFullscreen(): boolean {
    return fullscreenElementFor(this.video) === this.video;
  }

  get isFullscreen(): boolean {
    const fs = fullscreenElementFor(this.video);
    return !!fs && composedContains(fs, this.host);
  }

  /** FR-V10: our own fullscreen on the player container, so the subtitles come along. User gesture only. */
  async toggleFullscreen(): Promise<void> {
    if (document.fullscreenElement) {
      await document.exitFullscreen();
      return;
    }
    await this.container()?.requestFullscreen();
  }

  destroy(): void {
    this.host.remove();
  }

  getSelectionIn(): ShadowSelection | null {
    const sel = document.getSelection();
    if (!sel || sel.isCollapsed || sel.rangeCount === 0) return null;
    const text = sel.toString().trim();
    if (!text) return null;
    // Firefox exposes shadow-tree ranges through the document selection; newer engines need
    // getComposedRanges to see inside the shadow root.
    const composed = (
      sel as Selection & {
        getComposedRanges?: (o: { shadowRoots: ShadowRoot[] }) => StaticRange[];
      }
    ).getComposedRanges?.({ shadowRoots: [this.shadow] })[0];
    const range = composed ?? sel.getRangeAt(0);
    if (!this.shadow.contains(range.startContainer) || !this.shadow.contains(range.endContainer)) {
      return null;
    }
    // Snap to whole words: each word is its own `.w` span, so partial words extend to the span edges.
    const inWord = (n: Node) => n.nodeType === Node.TEXT_NODE && !!n.parentElement?.closest('.w');
    const live = document.createRange();
    live.setStart(range.startContainer, inWord(range.startContainer) ? 0 : range.startOffset);
    live.setEnd(
      range.endContainer,
      inWord(range.endContainer)
        ? (range.endContainer.textContent?.length ?? range.endOffset)
        : range.endOffset,
    );
    return {
      text: live.toString().replace(/\s+/g, ' ').trim() || text,
      startNode: range.startContainer,
      endNode: range.endContainer,
      rect: live.getBoundingClientRect(),
    };
  }
}

export interface ShadowSelection {
  text: string;
  startNode: Node;
  endNode: Node;
  rect: DOMRect;
}
