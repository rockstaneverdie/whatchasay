import * as library from '../storage/library';
import type { BgRequest, BgResponse, BgResponses, Wire } from './types';

type Handlers = {
  [K in keyof BgResponses]: (msg: Extract<BgRequest, { type: K }>) => Promise<BgResponses[K]>;
};

/** Handlers that later milestones extend (explain cache, phrases, provider status). */
export const handlers: Partial<Handlers> = {
  'library/get': (m) => library.getForMedia(m.mediaKey),
  'library/save': (m) => library.saveForMedia(m.mediaKey, m.track, m.mediaInfo),
  'library/update': async (m) => {
    await library.updateEntry(m.mediaKey, {
      ...(m.offsetMs !== undefined ? { offsetMs: m.offsetMs } : {}),
      ...(m.mediaInfo ? { mediaInfo: m.mediaInfo } : {}),
    });
    return null;
  },
  'library/track-info': (m) => library.getTrackMediaInfo(m.trackId),
  'open-options': async (m) => {
    await browser.storage.session?.set({ optionsSection: m.section ?? 'settings' }).catch(() => {});
    await browser.runtime.openOptionsPage();
    return null;
  },
};

export async function route<T extends BgRequest>(msg: T): Promise<Wire<BgResponse<T>>> {
  const handler = handlers[msg?.type] as ((m: T) => Promise<BgResponse<T>>) | undefined;
  if (!handler) return { ok: false, error: `unknown message ${String(msg?.type)}` };
  try {
    return { ok: true, value: await handler(msg) };
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : String(e) };
  }
}
