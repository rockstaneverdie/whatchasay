import { openDB, type DBSchema, type IDBPDatabase } from 'idb';
import type { MediaInfo, Track } from '../subtitles/types';
import type { ExplainType, Confidence } from '../ai/types';

export interface LibraryEntry {
  /** TZ 6.2: hash(origin + pathname + page title). */
  mediaKey: string;
  trackId: string;
  offsetMs: number;
  mediaInfo: MediaInfo;
  label: string;
  createdAt: number;
  updatedAt: number;
}

export interface TrackRecord {
  id: string;
  track: Track;
  /** FR-M3: what the user said this track is, reused when it is loaded elsewhere. */
  mediaInfo: MediaInfo;
  updatedAt: number;
}

export interface CachedExplanation {
  key: string;
  text: string;
  type: ExplainType;
  confidence: Confidence;
  expr?: string;
  model: string;
  createdAt: number;
  lastAccess: number;
  /** Approximate bytes, for the LRU limit. */
  size: number;
  /** 👎: never served again (FR-K3). */
  bad?: boolean;
}

export interface SavedPhrase {
  id?: number;
  phrase: string;
  cueText: string;
  explanation: string;
  type: ExplainType;
  show: string;
  time: number;
  createdAt: number;
}

export interface Feedback {
  key: string;
  value: 'up' | 'down';
  createdAt: number;
}

interface SubtextDB extends DBSchema {
  library: { key: string; value: LibraryEntry; indexes: { byTrack: string } };
  tracks: { key: string; value: TrackRecord };
  explanations: { key: string; value: CachedExplanation; indexes: { byLastAccess: number } };
  phrases: { key: number; value: SavedPhrase; indexes: { byCreatedAt: number } };
  feedback: { key: string; value: Feedback };
}

export type DB = IDBPDatabase<SubtextDB>;

let dbPromise: Promise<DB> | null = null;

export function getDb(name = 'subtext'): Promise<DB> {
  dbPromise ??= openDB<SubtextDB>(name, 1, {
    upgrade(db) {
      db.createObjectStore('library', { keyPath: 'mediaKey' }).createIndex('byTrack', 'trackId');
      db.createObjectStore('tracks', { keyPath: 'id' });
      db.createObjectStore('explanations', { keyPath: 'key' }).createIndex('byLastAccess', 'lastAccess');
      db.createObjectStore('phrases', { keyPath: 'id', autoIncrement: true }).createIndex(
        'byCreatedAt',
        'createdAt',
      );
      db.createObjectStore('feedback', { keyPath: 'key' });
    },
  });
  return dbPromise;
}

/** Tests only. */
export function resetDbForTests(): void {
  dbPromise = null;
}
