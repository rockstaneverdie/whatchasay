import { decodeSubtitleBytes } from '../subtitles/decode';
import { log } from '../../utils/log';
import { SniffStore } from './sniff';

/** The permission that turns interception on. Granting it is the opt-in (FR-S8). */
export const INTERCEPT_PERMISSION = { permissions: ['webRequest'] as const, origins: ['<all_urls>'] };

type HeadersDetails = {
  tabId: number;
  url: string;
  method: string;
  statusCode: number;
  type: string;
  responseHeaders?: { name: string; value?: string }[];
};

/**
 * Background side of FR-S8. Watches response headers only (no blocking, no body access); the
 * subtitle file is fetched again when the user picks it. Nothing leaves the browser.
 */
export class Sniffer {
  readonly store = new SniffStore();
  private listening = false;

  private readonly onHeaders = (d: HeadersDetails) => {
    if (d.tabId < 0) return;
    if (d.type === 'main_frame') {
      this.store.clear(d.tabId);
      return;
    }
    if (d.method !== 'GET' || d.statusCode < 200 || d.statusCode >= 300) return;
    const ct = d.responseHeaders?.find((h) => h.name.toLowerCase() === 'content-type')?.value;
    this.store.add(d.tabId, d.url, ct);
  };

  /** Registers the listener when the optional permission is present; idempotent. */
  sync(): void {
    const wr = (browser as { webRequest?: typeof browser.webRequest }).webRequest;
    if (!wr?.onHeadersReceived) {
      this.listening = false;
      return;
    }
    if (this.listening) return;
    try {
      wr.onHeadersReceived.addListener(
        this.onHeaders as never,
        { urls: ['<all_urls>'], types: ['main_frame', 'xmlhttprequest', 'media', 'other'] },
        ['responseHeaders'],
      );
      this.listening = true;
    } catch (e) {
      log.warn('webRequest unavailable', e);
    }
  }

  stop(): void {
    const wr = (browser as { webRequest?: typeof browser.webRequest }).webRequest;
    if (this.listening) wr?.onHeadersReceived.removeListener(this.onHeaders as never);
    this.listening = false;
  }

  get active(): boolean {
    return this.listening;
  }

  /** Fetches every part of a group again (small text files) and decodes them. */
  async fetchGroup(tabId: number, key: string): Promise<{ parts: string[]; failed: number }> {
    const urls = this.store.urls(tabId, key);
    const parts: string[] = [];
    let failed = 0;
    for (const url of urls) {
      try {
        const res = await fetch(url, { credentials: 'include' });
        if (!res.ok) {
          failed++;
          continue;
        }
        parts.push(decodeSubtitleBytes(new Uint8Array(await res.arrayBuffer())).text);
      } catch {
        failed++;
      }
    }
    return { parts, failed };
  }
}

/** One per background page. */
export const sniffer = new Sniffer();
