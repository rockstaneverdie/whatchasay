import { readPageTrack } from '../core/player/page-tracks';
import { sendBg } from '../core/messaging/types';
import type { OsResult } from '../core/sources/opensubtitles';
import { parseSubtitles } from '../core/subtitles/parse';
import { applySync, estimateSync, isConfident, type SyncResult } from '../core/subtitles/sync';
import { buildTrack } from '../core/subtitles/track';
import type { RawCue } from '../core/subtitles/types';
import { log } from '../utils/log';
import type { SubtextApp } from './app';

/**
 * Content side of M4 (FR-S7, FR-S8): OpenSubtitles results and subtitle files the page loaded.
 * All network traffic goes through the background; this only parses and aligns text.
 */
export class SourcesClient {
  constructor(private readonly app: SubtextApp) {
    app.sourceActions = {
      osSearch: (params) => sendBg({ type: 'os/search', params }),
      osLoad: (result) => this.loadFromOpenSubtitles(result),
      refreshSniffed: () => void this.refreshSniffed(),
      importSniffed: (key) => void this.importSniffed(key).catch((e) => log.warn('sniffed import failed', e)),
    };
  }

  private get state() {
    return this.app.state;
  }

  async refreshSniffed(): Promise<void> {
    try {
      const r = await sendBg({ type: 'sniff/list' });
      this.state.sniffActive = r.active;
      this.state.sniffed = r.groups;
    } catch (e) {
      log.warn('sniff list failed', e);
    }
  }

  private parseParts(parts: string[], name: string): RawCue[] {
    const out: RawCue[] = [];
    for (const text of parts) {
      try {
        out.push(...parseSubtitles(text, name).cues);
      } catch {
        // An empty segment (a gap without speech) is normal for segmented subtitles.
      }
    }
    return out;
  }

  async importSniffed(key: string): Promise<void> {
    const group = this.state.sniffed.find((g) => g.key === key);
    if (!group) return;
    const r = await sendBg({ type: 'sniff/fetch', key });
    if (!r.ok) {
      this.app.toast(this.state.t('toast.sniffFailed'));
      return;
    }
    const raw = this.parseParts(r.parts, `${group.label}.${group.format}`);
    if (raw.length === 0) {
      this.app.toast(this.state.t('toast.sniffFailed'));
      return;
    }
    const track = await buildTrack(raw, {
      label: group.label,
      source: 'intercepted',
      ...(group.lang ? { lang: group.lang } : {}),
    });
    await this.app.loadTrack(track);
    this.app.toast(this.state.t('toast.sniffLoaded', { label: group.label, n: track.cues.length }));
  }

  /**
   * Speech timing is shared across languages, so any track that already matches this video —
   * the one loaded before, or the page's own captions — is a reference for autosync.
   */
  private async referenceStarts(): Promise<number[]> {
    const current = this.state.track;
    if (current && current.cues.length >= 10) {
      const shift = current.offsetMs / 1000;
      return current.cues.filter((c) => c.kind === 'speech').map((c) => c.start + shift);
    }
    const video = this.app.currentVideo;
    for (const t of this.state.pageTracks) {
      if (!video) break;
      const cues = await readPageTrack(video, t.index).catch(() => []);
      if (cues.length >= 10) return cues.map((c) => c.start);
    }
    return [];
  }

  async loadFromOpenSubtitles(result: OsResult): Promise<void> {
    const r = await sendBg({ type: 'os/download', fileId: result.fileId });
    if (!r.ok) throw Object.assign(new Error(r.message), { code: r.code, retryAfter: r.retryAfter });
    let raw = parseSubtitles(r.text, r.name).cues;

    let sync: SyncResult | null = null;
    if (this.state.settings.sources.autoSync) {
      const ref = await this.referenceStarts();
      if (ref.length > 0) {
        sync = estimateSync(
          ref,
          raw.map((c) => c.start),
        );
        if (isConfident(sync)) raw = applySync(raw, sync);
        else sync = null;
      }
    }

    const track = await buildTrack(raw, {
      label: result.release || r.name,
      source: 'opensubtitles',
      ...(result.language ? { lang: result.language } : {}),
    });
    // M4: the result knows which show/episode it belongs to.
    await this.app.loadTrack(track, result.media);
    const parts = [this.state.t('toast.osLoaded', { label: track.label, n: track.cues.length })];
    if (sync) {
      const shift = `${sync.offset >= 0 ? '+' : ''}${sync.offset.toFixed(1)}`;
      parts.push(
        sync.scale === 1
          ? this.state.t('toast.synced', { shift })
          : this.state.t('toast.syncedFps', { shift, scale: sync.scale.toFixed(4) }),
      );
    } else if (this.state.settings.sources.autoSync) {
      parts.push(this.state.t('toast.syncNone'));
    }
    if (r.remaining !== undefined) parts.push(this.state.t('toast.osRemaining', { n: r.remaining }));
    this.app.toast(parts.join(' · '), undefined, 7000);
  }
}
