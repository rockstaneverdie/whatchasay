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

export function findVideos(doc: Document): HTMLVideoElement[] {
  return Array.from(doc.querySelectorAll('video'));
}
