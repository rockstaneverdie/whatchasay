import type { MediaInfo, Track } from '../subtitles/types';
import { getDb, type LibraryEntry } from './idb';

export interface LoadedTrack {
  entry: LibraryEntry;
  track: Track;
}

/** FR-S5: the track remembered for this page/video, if any. */
export async function getForMedia(mediaKey: string): Promise<LoadedTrack | null> {
  const db = await getDb();
  const entry = await db.get('library', mediaKey);
  if (!entry) return null;
  const rec = await db.get('tracks', entry.trackId);
  if (!rec) return null;
  return { entry, track: { ...rec.track, offsetMs: entry.offsetMs } };
}

/** Saves the track and binds it to the media key. Returns the media info to use (FR-M3). */
export async function saveForMedia(
  mediaKey: string,
  track: Track,
  mediaInfo: MediaInfo,
): Promise<LibraryEntry> {
  const db = await getDb();
  const now = Date.now();
  const prevTrack = await db.get('tracks', track.id);
  const info = { ...(prevTrack?.mediaInfo ?? {}), ...stripEmpty(mediaInfo) };
  await db.put('tracks', { id: track.id, track, mediaInfo: info, updatedAt: now });
  const prev = await db.get('library', mediaKey);
  const entry: LibraryEntry = {
    mediaKey,
    trackId: track.id,
    offsetMs: track.offsetMs,
    mediaInfo: info,
    label: track.label,
    createdAt: prev?.createdAt ?? now,
    updatedAt: now,
  };
  await db.put('library', entry);
  return entry;
}

export async function getTrackMediaInfo(trackId: string): Promise<MediaInfo | null> {
  return (await (await getDb()).get('tracks', trackId))?.mediaInfo ?? null;
}

export async function updateEntry(
  mediaKey: string,
  patch: { offsetMs?: number; mediaInfo?: MediaInfo },
): Promise<void> {
  const db = await getDb();
  const entry = await db.get('library', mediaKey);
  if (!entry) return;
  if (patch.offsetMs !== undefined) entry.offsetMs = patch.offsetMs;
  if (patch.mediaInfo) {
    entry.mediaInfo = patch.mediaInfo;
    const rec = await db.get('tracks', entry.trackId);
    if (rec) {
      rec.mediaInfo = patch.mediaInfo;
      rec.updatedAt = Date.now();
      await db.put('tracks', rec);
    }
  }
  entry.updatedAt = Date.now();
  await db.put('library', entry);
}

export async function forgetMedia(mediaKey: string): Promise<void> {
  await (await getDb()).delete('library', mediaKey);
}

function stripEmpty(m: MediaInfo): MediaInfo {
  return Object.fromEntries(
    Object.entries(m).filter(([, v]) => v !== undefined && v !== '' && !Number.isNaN(v)),
  ) as MediaInfo;
}
