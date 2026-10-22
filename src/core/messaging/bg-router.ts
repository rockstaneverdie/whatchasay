import { createProvider, providerModel } from '../ai/providers';
import { ProviderError } from '../ai/types';
import * as cache from '../storage/cache';
import { getDb } from '../storage/idb';
import * as library from '../storage/library';
import { addPhrase } from '../storage/phrases';
import { osDownload, osLogin, osLogout, osSearch, osStatus } from '../sources/service';
import { sniffer } from '../sources/sniffer';
import { loadSecrets } from '../storage/secrets';
import { loadSettings } from '../storage/settings';
import type { BgRequest, BgResponse, BgResponses, Wire } from './types';

export interface Sender {
  tab?: { id?: number };
}

type Handlers = {
  [K in keyof BgResponses]: (msg: Extract<BgRequest, { type: K }>, sender: Sender) => Promise<BgResponses[K]>;
};

const maxCacheBytes = async () => (await loadSettings()).cacheMaxMB * 1024 * 1024;

export const handlers: Handlers = {
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
  'phrases/add': async (m) => ({ id: await addPhrase(m.phrase) }),
  feedback: async (m) => {
    // Kept locally only, for judging prompt quality; 👎 also retires the cached answer.
    await (await getDb()).put('feedback', { key: m.cacheKey, value: m.value, createdAt: Date.now() });
    if (m.value === 'down') await cache.markBad(m.cacheKey);
    return null;
  },
  'open-options': async () => {
    await browser.runtime.openOptionsPage();
    return null;
  },
  'provider/status': async () => {
    const [settings, secrets] = await Promise.all([loadSettings(), loadSecrets()]);
    const configured =
      settings.provider === 'gemini'
        ? !!secrets.geminiKey
        : !!settings.openai.baseUrl && !!settings.openai.model;
    return { configured, provider: settings.provider, model: providerModel(settings) };
  },
  'provider/models': async () => {
    try {
      const provider = await createProvider(await loadSettings(), await loadSecrets());
      return { ok: true, models: await provider.listModels() };
    } catch (e) {
      const err = e instanceof ProviderError ? e : null;
      return { ok: false, code: err?.code ?? 'unknown', message: e instanceof Error ? e.message : String(e) };
    }
  },
  'cache/stats': () => cache.cacheStats(),
  'cache/clear': async () => {
    await cache.clearCache();
    return null;
  },
  'cache/export': () => cache.exportCache(),
  'cache/import': async (m) => ({ imported: await cache.importCache(m.records, await maxCacheBytes()) }),
  'os/status': () => osStatus(),
  'os/search': (m) => osSearch(m.params),
  'os/download': (m) => osDownload(m.fileId),
  'os/login': (m) => osLogin(m.username, m.password),
  'os/logout': () => osLogout(),
  'sniff/list': async (_m, sender) => ({
    active: sniffer.active,
    groups: sender.tab?.id !== undefined ? sniffer.store.list(sender.tab.id) : [],
  }),
  'sniff/fetch': async (m, sender) => {
    const tabId = sender.tab?.id;
    const group = tabId !== undefined ? sniffer.store.list(tabId).find((g) => g.key === m.key) : undefined;
    if (tabId === undefined || !group)
      return { ok: false, code: 'bad-response', message: 'unknown subtitle group' };
    const { parts, failed } = await sniffer.fetchGroup(tabId, m.key);
    if (parts.length === 0)
      return { ok: false, code: 'network', message: `could not fetch ${failed} file(s)` };
    return { ok: true, parts, failed, format: group.format };
  },
};

export async function route<T extends BgRequest>(msg: T, sender: Sender = {}): Promise<Wire<BgResponse<T>>> {
  const handler = handlers[msg?.type as keyof Handlers] as unknown as
    ((m: T, s: Sender) => Promise<BgResponse<T>>) | undefined;
  if (!handler) return { ok: false, error: `unknown message ${String(msg?.type)}` };
  try {
    return { ok: true, value: await handler(msg, sender) };
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : String(e) };
  }
}
