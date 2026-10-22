import type { ExplainMode, ExplainRequest, ExplainResult, ModelInfo, ProviderErrorCode } from '../ai/types';
import type { CachedExplanation, LibraryEntry, SavedPhrase } from '../storage/idb';
import type { MediaInfo, Track } from '../subtitles/types';

/** content/popup/options → background, via runtime.sendMessage. */
export type BgRequest =
  | { type: 'library/get'; mediaKey: string }
  | { type: 'library/save'; mediaKey: string; track: Track; mediaInfo: MediaInfo }
  | { type: 'library/update'; mediaKey: string; offsetMs?: number; mediaInfo?: MediaInfo }
  | { type: 'library/track-info'; trackId: string }
  | { type: 'phrases/add'; phrase: Omit<SavedPhrase, 'id' | 'createdAt'> }
  | { type: 'feedback'; cacheKey: string; value: 'up' | 'down' }
  | { type: 'open-options'; section?: 'settings' | 'phrases' }
  | { type: 'provider/status' }
  | { type: 'provider/models' }
  | { type: 'cache/stats' }
  | { type: 'cache/clear' }
  | { type: 'cache/export' }
  | { type: 'cache/import'; records: unknown };

export interface BgResponses {
  'library/get': { entry: LibraryEntry; track: Track } | null;
  'library/save': LibraryEntry;
  'library/update': null;
  'library/track-info': MediaInfo | null;
  'phrases/add': { id: number };
  feedback: null;
  'open-options': null;
  'provider/status': { configured: boolean; provider: string; model: string };
  /** Errors come back as data so the options page can show the right message. */
  'provider/models':
    { ok: true; models: ModelInfo[] } | { ok: false; code: ProviderErrorCode | 'unknown'; message: string };
  'cache/stats': { entries: number; bytes: number };
  'cache/clear': null;
  'cache/export': CachedExplanation[];
  'cache/import': { imported: number };
}

export type BgResponse<T extends BgRequest> = BgResponses[T['type']];

/** Wire wrapper so errors cross the boundary as data. */
export type Wire<T> = { ok: true; value: T } | { ok: false; error: string };

export async function sendBg<T extends BgRequest>(msg: T): Promise<BgResponse<T>> {
  const res = (await browser.runtime.sendMessage(msg)) as Wire<BgResponse<T>> | undefined;
  if (!res) throw new Error(`[subtext] no response to ${msg.type}`);
  if (!res.ok) throw new Error(res.error);
  return res.value;
}

/** Explain port (TZ 6.7). */
export const EXPLAIN_PORT = 'subtext-explain';

export type ExplainClientMsg =
  { type: 'start'; reqId: number; req: ExplainRequest; force?: boolean } | { type: 'cancel'; reqId: number };

export type ExplainServerMsg =
  | { type: 'meta'; reqId: number; cacheKey: string; cached: boolean; model: string }
  | { type: 'chunk'; reqId: number; text: string }
  | { type: 'done'; reqId: number; result: ExplainResult; cacheKey: string }
  | { type: 'retrying'; reqId: number; attempt: number; delayMs: number }
  | {
      type: 'error';
      reqId: number;
      code: ProviderErrorCode | 'unknown';
      message: string;
      retryAfter?: number;
    };

/** popup → content script of the active tab (all frames). */
export type TabRequest =
  | { type: 'ui/status' }
  | { type: 'ui/toggle-panel' }
  | { type: 'ui/load-file'; name: string; bytes: number[] };

export interface TabStatus {
  hasVideo: boolean;
  trackLabel?: string;
  cues?: number;
  panelVisible: boolean;
}

export type { ExplainMode };
