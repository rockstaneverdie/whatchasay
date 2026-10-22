import { mount, unmount } from 'svelte';
import { CueIndex, subtitleTime } from '../core/player/clock';
import { describeVideo } from '../core/player/find-video';
import { isEditableTarget, matchHotkey } from '../core/player/hotkeys';
import { VideoWatcher } from '../core/player/video-watcher';
import { sendBg, type TabRequest, type TabStatus } from '../core/messaging/types';
import { loadSettings, onSettingsChanged, saveSettings } from '../core/storage/settings';
import type { SubtitleEncoding } from '../core/subtitles/decode';
import { guessMediaInfo } from '../core/subtitles/media-info';
import { buildTrack, trackFromFile } from '../core/subtitles/track';
import { listPageTracks, readPageTrack } from '../core/player/page-tracks';
import type { MediaInfo, Track } from '../core/subtitles/types';
import { sha256Hex } from '../utils/hash';
import { log, safe } from '../utils/log';
import type { OverlayActions } from './actions';
import { OverlayHost } from './host';
import Overlay from './Overlay.svelte';
import { OverlayState, type ExplainTarget } from './state.svelte';

const SUBTITLE_FILE = /\.(srt|vtt)$/i;
const LAUNCHER_HIDE_MS = 2500;
const TOAST_MS = 4000;

function swallow(e: Event) {
  e.preventDefault();
  e.stopImmediatePropagation();
}

function sameIndices(a: readonly number[], b: readonly number[]): boolean {
  return a.length === b.length && a.every((v, i) => v === b[i]);
}

function hasFiles(e: DragEvent): boolean {
  return Array.from(e.dataTransfer?.types ?? []).includes('Files');
}

export interface AppContext {
  onInvalidated(cb: () => void): void;
}

/** Content-script controller: one per frame, owns the chosen <video> and the overlay. */
export class SubtextApp {
  readonly state = new OverlayState();
  private watcher: VideoWatcher | null = null;
  private video: HTMLVideoElement | null = null;
  private pinned: HTMLVideoElement | null = null;
  private host: OverlayHost | null = null;
  private component: Record<string, unknown> | null = null;
  private index: CueIndex | null = null;
  private raf = 0;
  private mediaKey = '';
  private lastSrc = '';
  private file: { name: string; bytes: Uint8Array } | null = null;
  private videoCleanup: (() => void)[] = [];
  private globalCleanup: (() => void)[] = [];
  private toastTimer: ReturnType<typeof setTimeout> | undefined;
  private launcherTimer: ReturnType<typeof setTimeout> | undefined;
  private dragTimer: ReturnType<typeof setTimeout> | undefined;
  private offsetSaveTimer: ReturnType<typeof setTimeout> | undefined;
  private swallowSpaceUp = false;
  private toastSeq = 0;
  /** Set by the explain client (M2). */
  explainHandler: ((target: ExplainTarget) => void) | null = null;
  cardActions: Partial<OverlayActions> = {};

  constructor(private readonly ctx: AppContext) {}

  async start(): Promise<void> {
    try {
      this.state.settings = await loadSettings();
    } catch (e) {
      log.warn('settings unavailable, using defaults', e);
    }
    this.globalCleanup.push(onSettingsChanged((s) => (this.state.settings = s)));

    const motion = matchMedia('(prefers-reduced-motion: reduce)');
    const dark = matchMedia('(prefers-color-scheme: dark)');
    const syncMedia = () => {
      this.state.reducedMotion = motion.matches;
      this.state.systemDark = dark.matches;
    };
    syncMedia();
    this.listen(motion, 'change', syncMedia);
    this.listen(dark, 'change', syncMedia);

    this.listen(window, 'keydown', this.onKeyDown, true);
    this.listen(window, 'keyup', this.onKeyUp, true);
    this.listen(window, 'keypress', this.onKeyUp, true);
    this.listen(window, 'dragenter', this.onDragOver, true);
    this.listen(window, 'dragover', this.onDragOver, true);
    this.listen(window, 'drop', this.onDrop, true);
    this.listen(document, 'mousemove', this.onMouseMove, { capture: true, passive: true });
    this.listen(document, 'fullscreenchange', this.reposition);
    this.listen(window, 'resize', this.reposition);

    const onMessage = (msg: unknown) => this.onTabMessage(msg as TabRequest);
    browser.runtime.onMessage.addListener(onMessage);
    this.globalCleanup.push(() => browser.runtime.onMessage.removeListener(onMessage));

    this.watcher = new VideoWatcher(document, (ranked) => safe(() => this.onVideos(ranked)));
    this.ctx.onInvalidated(() => this.destroy());
  }

  private listen(
    target: EventTarget,
    type: string,
    fn: (e: never) => void,
    opts?: boolean | AddEventListenerOptions,
  ) {
    const wrapped = (e: Event) => safe(() => (fn as (e: Event) => void)(e));
    target.addEventListener(type, wrapped, opts);
    this.globalCleanup.push(() => target.removeEventListener(type, wrapped, opts));
  }

  // ---------------------------------------------------------------- videos

  private onVideos(ranked: HTMLVideoElement[]) {
    const cur = this.video;
    const keep =
      cur?.isConnected &&
      (cur === this.pinned ||
        (ranked.includes(cur) && (!cur.paused || !ranked[0] || ranked[0].paused || ranked[0] === cur)));
    if (!keep) {
      if (this.pinned && !this.pinned.isConnected) this.pinned = null;
      const next = this.pinned ?? ranked[0] ?? null;
      if (next !== cur) this.attach(next);
    }
    this.refreshVideoChoices();
  }

  private refreshVideoChoices() {
    const vids = this.watcher?.videos ?? [];
    this.state.videos = vids.map((v, index) => {
      const d = describeVideo(v);
      return { index, width: d.width, height: d.height, current: v === this.video };
    });
  }

  private attach(video: HTMLVideoElement | null) {
    this.detachVideo();
    this.video = video;
    if (!video) return;

    const host = new OverlayHost(video, (f) => this.actions.loadFile(f));
    this.host = host;
    host.attach();
    this.component = mount(Overlay, {
      target: host.root,
      props: {
        ui: this.state,
        actions: this.actions,
        getSelection: () => this.host?.getSelectionIn() ?? null,
        root: host.root,
      },
    });

    const on = (type: string, fn: () => void) => {
      const wrapped = () => safe(fn);
      video.addEventListener(type, wrapped);
      this.videoCleanup.push(() => video.removeEventListener(type, wrapped));
    };
    on('play', () => {
      this.state.playing = true;
      this.startLoop();
    });
    on('playing', () => this.startLoop());
    on('pause', () => {
      this.state.playing = false;
      this.updateClock();
    });
    on('ended', () => (this.state.playing = false));
    for (const t of ['seeking', 'seeked', 'timeupdate', 'ratechange', 'loadedmetadata'])
      on(t, this.updateClock);
    on('loadstart', () => this.onSourceChange());
    on('loadedmetadata', this.refreshPageTracks);
    const tt = video.textTracks;
    const onTracks = () => safe(this.refreshPageTracks);
    tt.addEventListener('addtrack', onTracks);
    tt.addEventListener('removetrack', onTracks);
    this.videoCleanup.push(() => {
      tt.removeEventListener('addtrack', onTracks);
      tt.removeEventListener('removetrack', onTracks);
    });
    this.refreshPageTracks();

    const ro = new ResizeObserver(() => safe(this.reposition));
    ro.observe(video);
    if (video.parentElement) ro.observe(video.parentElement);
    this.videoCleanup.push(() => ro.disconnect());
    const interval = setInterval(() => safe(this.reposition), 1000);
    this.videoCleanup.push(() => clearInterval(interval));

    this.lastSrc = video.currentSrc || video.src;
    this.state.playing = !video.paused;
    this.reposition();
    if (this.state.playing) this.startLoop();
    // Titles of SPA pages often settle a moment after the player swaps.
    const t = setTimeout(() => void this.restoreForPage(), 300);
    this.videoCleanup.push(() => clearTimeout(t));
  }

  private detachVideo() {
    cancelAnimationFrame(this.raf);
    this.raf = 0;
    for (const fn of this.videoCleanup.splice(0)) safe(fn);
    if (this.component) void unmount(this.component);
    this.component = null;
    this.host?.destroy();
    this.host = null;
    this.video = null;
  }

  /** FR-V2: a new source in the same element means a new episode. */
  private onSourceChange() {
    const v = this.video;
    if (!v) return;
    const src = v.currentSrc || v.src;
    if (!src || src === this.lastSrc) return;
    const hadSource = this.lastSrc !== '';
    this.lastSrc = src;
    if (hadSource) setTimeout(() => void this.restoreForPage(true), 300);
  }

  private refreshPageTracks = () => {
    this.state.pageTracks = this.video ? listPageTracks(this.video) : [];
  };

  private async importPageTrack(index: number) {
    const video = this.video;
    const info = this.state.pageTracks.find((t) => t.index === index);
    if (!video || !info) return;
    const raw = await readPageTrack(video, index);
    if (raw.length === 0) {
      this.toast(this.state.t('toast.trackFailed'));
      return;
    }
    const track = await buildTrack(raw, {
      label: info.label,
      source: 'dom-track',
      ...(info.lang ? { lang: info.lang } : {}),
    });
    await this.loadTrack(track);
    this.toast(this.state.t('toast.trackImported', { label: info.label }));
  }

  private reposition = () => {
    if (!this.host) return;
    const box = this.host.position();
    if (box.width !== this.state.box.width || box.height !== this.state.box.height) this.state.box = box;
  };

  // ---------------------------------------------------------------- tracks

  private async computeMediaKey(): Promise<string> {
    return (await sha256Hex(location.origin + location.pathname + document.title)).slice(0, 16);
  }

  /** FR-S5: pick up the track remembered for this page. */
  private async restoreForPage(sourceChanged = false) {
    const key = await this.computeMediaKey();
    if (key === this.mediaKey && this.state.track && !sourceChanged) return;
    const hadTrack = this.state.track !== null;
    this.mediaKey = key;
    this.clearTrack();
    const found = await sendBg({ type: 'library/get', mediaKey: key }).catch((e) => {
      log.warn('library lookup failed', e);
      return null;
    });
    if (key !== this.mediaKey) return;
    if (found) {
      this.setTrack(found.track);
      this.state.mediaInfo = found.entry.mediaInfo;
      this.toast(this.state.t('toast.restored', { label: found.track.label }), {
        label: this.state.t('toast.change'),
        run: () => this.actions.pickFile(),
      });
    } else if (hadTrack) {
      this.toast(this.state.t('toast.newVideo'), {
        label: this.state.t('panel.choose'),
        run: () => this.actions.pickFile(),
      });
    }
  }

  private setTrack(track: Track) {
    this.cardActions.closeCard?.(false);
    this.index = new CueIndex(track.cues);
    this.state.offsetMs = track.offsetMs;
    this.state.track = track;
    this.state.panelVisible = true;
    this.state.focus = -1;
    this.state.active = [];
    this.updateClock();
  }

  private clearTrack() {
    this.cardActions.closeCard?.(false);
    this.index = null;
    this.state.track = null;
    this.state.active = [];
    this.state.focus = -1;
    this.state.offsetMs = 0;
    this.state.mediaInfo = {};
  }

  private async loadBytes(name: string, bytes: Uint8Array, encoding?: SubtitleEncoding) {
    try {
      const { track } = await trackFromFile(bytes, name, encoding);
      const known = await sendBg({ type: 'library/track-info', trackId: track.id }).catch(() => null);
      const info: MediaInfo = { ...guessMediaInfo(name, document.title), ...(known ?? {}) };
      this.setTrack(track);
      this.state.mediaInfo = info;
      this.mediaKey ||= await this.computeMediaKey();
      await sendBg({ type: 'library/save', mediaKey: this.mediaKey, track, mediaInfo: info }).catch((e) =>
        log.warn('could not save track', e),
      );
      this.toast(this.state.t('toast.loaded', { label: track.label, n: track.cues.length }));
    } catch (e) {
      log.warn('parse failed', e);
      this.toast(this.state.t('toast.parseError', { error: e instanceof Error ? e.message : String(e) }));
    }
  }

  async loadTrack(track: Track) {
    this.setTrack(track);
    this.state.mediaInfo = guessMediaInfo(undefined, document.title);
    this.mediaKey ||= await this.computeMediaKey();
    await sendBg({
      type: 'library/save',
      mediaKey: this.mediaKey,
      track,
      mediaInfo: this.state.mediaInfo,
    }).catch((e) => log.warn('could not save track', e));
  }

  // ---------------------------------------------------------------- clock

  /** NFR-1/NFR-3: per-frame only while playing; single updates on pause/seek. */
  private updateClock = () => {
    const v = this.video;
    if (!v) return;
    const t = subtitleTime(v.currentTime, this.state.offsetMs);
    this.state.time = t;
    if (!this.index) return;
    const act = this.index.active(t);
    if (!sameIndices(act, this.state.active)) this.state.active = act;
    const f = this.index.focusIndex(t);
    if (f !== this.state.focus) this.state.focus = f;
  };

  private loop = () => {
    this.raf = 0;
    safe(this.updateClock);
    const v = this.video;
    if (v && !v.paused && !v.ended) this.raf = requestAnimationFrame(this.loop);
  };

  private startLoop() {
    if (!this.raf) this.raf = requestAnimationFrame(this.loop);
  }

  // ---------------------------------------------------------------- input

  private onKeyDown = (e: KeyboardEvent) => {
    if (!this.video || e.isComposing) return;
    const editable = isEditableTarget(e);
    const plain = !e.altKey && !e.ctrlKey && !e.metaKey && !e.shiftKey;
    if (this.state.card && !editable) {
      // FR-I4: Space closes the card and resumes; the site's player must not see it.
      if (e.code === 'Space' && plain) {
        swallow(e);
        this.swallowSpaceUp = true;
        this.actions.closeCard(true);
        return;
      }
      if (e.code === 'Escape') {
        swallow(e);
        this.actions.closeCard(false);
        return;
      }
    }
    if (editable) return;
    const hk = this.state.settings.hotkeys;
    if (matchHotkey(e, hk.togglePanel)) {
      swallow(e);
      this.actions.togglePanel();
      return;
    }
    if (!this.state.track) return;
    if (matchHotkey(e, hk.explain)) {
      swallow(e);
      if (!e.repeat) this.explainCurrent();
    } else if (matchHotkey(e, hk.repeat)) {
      swallow(e);
      if (!e.repeat) this.actions.repeatCue(this.state.focus);
    } else if (matchHotkey(e, hk.offsetBack, true)) {
      swallow(e);
      this.actions.nudgeOffset(e.shiftKey ? -1000 : -100);
    } else if (matchHotkey(e, hk.offsetForward, true)) {
      swallow(e);
      this.actions.nudgeOffset(e.shiftKey ? 1000 : 100);
    }
  };

  private onKeyUp = (e: KeyboardEvent) => {
    if (this.swallowSpaceUp && e.code === 'Space') {
      swallow(e);
      if (e.type === 'keyup') this.swallowSpaceUp = false;
    }
  };

  private pointInVideo(x: number, y: number): boolean {
    const r = this.video?.getBoundingClientRect();
    return !!r && x >= r.left && x <= r.right && y >= r.top && y <= r.bottom;
  }

  private onDragOver = (e: DragEvent) => {
    if (!this.video || !hasFiles(e)) return;
    const inside = this.pointInVideo(e.clientX, e.clientY);
    if (!inside) {
      this.state.dragOver = false;
      return;
    }
    swallow(e);
    if (e.dataTransfer) e.dataTransfer.dropEffect = 'copy';
    this.state.dragOver = true;
    clearTimeout(this.dragTimer);
    this.dragTimer = setTimeout(() => (this.state.dragOver = false), 400);
  };

  private onDrop = (e: DragEvent) => {
    if (!this.video || !hasFiles(e) || !this.pointInVideo(e.clientX, e.clientY)) return;
    swallow(e);
    this.state.dragOver = false;
    const files = Array.from(e.dataTransfer?.files ?? []);
    const file = files.find((f) => SUBTITLE_FILE.test(f.name)) ?? files[0];
    if (file) this.actions.loadFile(file);
  };

  /** FR-V4: the launcher shows up while the pointer is over the video. */
  private onMouseMove = (e: MouseEvent) => {
    if (!this.video || !this.pointInVideo(e.clientX, e.clientY)) return;
    if (!this.state.launcherVisible) this.state.launcherVisible = true;
    clearTimeout(this.launcherTimer);
    this.launcherTimer = setTimeout(() => (this.state.launcherVisible = false), LAUNCHER_HIDE_MS);
  };

  private onTabMessage(msg: TabRequest): Promise<unknown> | undefined {
    if (!this.video) return undefined;
    const status = (): TabStatus => ({
      hasVideo: true,
      ...(this.state.track ? { trackLabel: this.state.track.label, cues: this.state.track.cues.length } : {}),
      panelVisible: this.state.panelVisible,
    });
    switch (msg?.type) {
      case 'ui/status':
        return Promise.resolve(status());
      case 'ui/toggle-panel':
        this.actions.togglePanel();
        return Promise.resolve(status());
      case 'ui/load-file': {
        const bytes = new Uint8Array(msg.bytes);
        this.file = { name: msg.name, bytes };
        this.state.hasFile = true;
        this.state.encoding = 'auto';
        return this.loadBytes(msg.name, bytes).then(status);
      }
      default:
        return undefined;
    }
  }

  // ---------------------------------------------------------------- UI glue

  toast(text: string, action?: { label: string; run: () => void }, ms = TOAST_MS) {
    this.state.toast = { id: ++this.toastSeq, text, ...(action ? { action } : {}) };
    clearTimeout(this.toastTimer);
    this.toastTimer = setTimeout(() => (this.state.toast = null), action ? ms * 2 : ms);
  }

  get currentVideo(): HTMLVideoElement | null {
    return this.video;
  }

  get currentMediaKey(): string {
    return this.mediaKey;
  }

  private explainCurrent() {
    const i = this.state.active.at(-1) ?? this.state.focus;
    if (i < 0) return;
    const cue = this.state.track?.cues[i];
    if (!cue || cue.kind !== 'speech') return;
    const el = this.host?.root.querySelector(`.line[data-index="${i}"]`) ?? undefined;
    this.actions.explain({ cueIndex: i, ...(el ? { anchorEl: el } : {}) });
  }

  readonly actions: OverlayActions = {
    pickFile: () => this.host?.fileInput.click(),
    loadFile: (file) =>
      void (async () => {
        if (!SUBTITLE_FILE.test(file.name)) {
          this.toast(this.state.t('toast.badFile'));
          return;
        }
        const bytes = new Uint8Array(await file.arrayBuffer());
        this.file = { name: file.name, bytes };
        this.state.hasFile = true;
        this.state.encoding = 'auto';
        await this.loadBytes(file.name, bytes);
      })(),
    setEncoding: (enc) => {
      this.state.encoding = enc;
      if (this.file) void this.loadBytes(this.file.name, this.file.bytes, enc === 'auto' ? undefined : enc);
    },
    seekToCue: (index) => {
      const cue = this.state.track?.cues[index];
      if (!cue || !this.video) return;
      this.video.currentTime = Math.max(0, cue.start + this.state.offsetMs / 1000);
      this.updateClock();
    },
    togglePanel: () => {
      if (!this.video) return;
      this.state.panelVisible = !this.state.panelVisible;
    },
    setCompact: (mode) => {
      this.state.settings.panel.compact = mode;
      void saveSettings({ panel: { compact: mode } });
    },
    setPanelWidth: (pct, persist) => {
      const v = Math.min(40, Math.max(28, pct));
      this.state.settings.panel.widthPct = v;
      if (persist) void saveSettings({ panel: { widthPct: v } });
    },
    saveMediaInfo: (info) => {
      this.state.mediaInfo = info;
      if (this.mediaKey) void sendBg({ type: 'library/update', mediaKey: this.mediaKey, mediaInfo: info });
    },
    selectVideo: (index) => {
      const v = this.watcher?.videos[index];
      if (!v) return;
      this.pinned = v;
      if (v !== this.video) this.attach(v);
      this.refreshVideoChoices();
    },
    importPageTrack: (index) =>
      void this.importPageTrack(index).catch((e) => log.warn('track import failed', e)),
    nudgeOffset: (deltaMs) => {
      this.state.offsetMs = Math.round(this.state.offsetMs + deltaMs);
      this.updateClock();
      const secs = this.state.offsetMs / 1000;
      this.toast(
        this.state.t('toast.offset', { value: `${secs >= 0 ? '+' : ''}${secs.toFixed(1)}` }),
        undefined,
        1500,
      );
      clearTimeout(this.offsetSaveTimer);
      this.offsetSaveTimer = setTimeout(() => {
        if (this.mediaKey && this.state.track) {
          void sendBg({ type: 'library/update', mediaKey: this.mediaKey, offsetMs: this.state.offsetMs });
        }
      }, 500);
    },
    openSettings: () => void sendBg({ type: 'open-options', section: 'settings' }),
    dismissToast: () => {
      clearTimeout(this.toastTimer);
      this.state.toast = null;
    },
    repeatCue: (index) => {
      const i = index >= 0 ? index : this.state.focus;
      const cue = this.state.track?.cues[i];
      if (!cue || !this.video) return;
      this.cardActions.closeCard?.(false);
      this.video.currentTime = Math.max(0, cue.start + this.state.offsetMs / 1000);
      void this.video.play().catch(() => {});
    },
    explain: (target) => {
      if (this.explainHandler) this.explainHandler(target);
      else this.video?.pause();
    },
    closeCard: (resume) => this.cardActions.closeCard?.(resume),
    explainMore: () => this.cardActions.explainMore?.(),
    refreshCard: () => this.cardActions.refreshCard?.(),
    saveCard: () => this.cardActions.saveCard?.(),
    copyCard: () => this.cardActions.copyCard?.(),
    rateCard: (v) => this.cardActions.rateCard?.(v),
    retryCard: () => this.cardActions.retryCard?.(),
  };

  destroy() {
    this.detachVideo();
    this.watcher?.destroy();
    for (const fn of this.globalCleanup.splice(0)) safe(fn);
  }
}
