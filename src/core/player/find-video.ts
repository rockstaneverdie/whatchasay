export const MIN_VIDEO_WIDTH = 200;
export const MIN_VIDEO_HEIGHT = 120;

export interface VideoInfo {
  width: number;
  height: number;
  visible: boolean;
  playing: boolean;
  /** Muted, looping, autoplaying, no controls: background/ad loops, not something to watch. */
  decorative: boolean;
}

export function describeVideo(v: HTMLVideoElement): VideoInfo {
  const r = v.getBoundingClientRect();
  const style = v.ownerDocument.defaultView?.getComputedStyle(v);
  const visible =
    v.isConnected &&
    r.width > 0 &&
    r.height > 0 &&
    style?.visibility !== 'hidden' &&
    style?.display !== 'none' &&
    Number(style?.opacity ?? '1') > 0.05;
  return {
    width: r.width,
    height: r.height,
    visible,
    playing: !v.paused && !v.ended && v.readyState > 2,
    decorative: v.muted && v.loop && v.autoplay && !v.controls,
  };
}

export function isEligible(info: VideoInfo): boolean {
  return info.visible && info.width >= MIN_VIDEO_WIDTH && info.height >= MIN_VIDEO_HEIGHT && !info.decorative;
}

/** FR-V1: eligible videos, best first (playing before paused, then by area). */
export function rankVideos(videos: Iterable<HTMLVideoElement>): HTMLVideoElement[] {
  return [...videos]
    .map((v) => ({ v, info: describeVideo(v) }))
    .filter(({ info }) => isEligible(info))
    .sort(
      (a, b) =>
        Number(b.info.playing) - Number(a.info.playing) ||
        b.info.width * b.info.height - a.info.width * a.info.height,
    )
    .map(({ v }) => v);
}

/**
 * FR-V6: every <video> in the document and in open shadow roots (web-component players), at any
 * depth. `roots` collects the shadow roots seen, so the caller can watch them too.
 */
export function findVideos(root: Document | ShadowRoot, roots?: ShadowRoot[]): HTMLVideoElement[] {
  const out: HTMLVideoElement[] = Array.from(root.querySelectorAll('video'));
  for (const el of Array.from(root.querySelectorAll('*'))) {
    const shadow = el.shadowRoot;
    if (!shadow) continue;
    roots?.push(shadow);
    out.push(...findVideos(shadow, roots));
  }
  return out;
}

type MaybeClosed = Element & { openOrClosedShadowRoot?: ShadowRoot | null };

/**
 * Closed shadow roots are off limits by design (FR-V6). Firefox lets extensions *see* them via
 * `openOrClosedShadowRoot`; it is used only to tell the user why nothing appears, never to mount.
 */
export function hasClosedPlayer(doc: Document): boolean {
  for (const el of Array.from(doc.querySelectorAll('*')) as MaybeClosed[]) {
    if (el.shadowRoot || !el.tagName.includes('-')) continue;
    const closed = el.openOrClosedShadowRoot;
    if (closed?.querySelector('video')) return true;
  }
  return false;
}
