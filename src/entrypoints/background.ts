import { ExplainService } from '../core/ai/explain-service';
import { frames, route, saveFrames } from '../core/messaging/bg-router';
import { EXPLAIN_PORT, type BgRequest } from '../core/messaging/types';
import { sniffer } from '../core/sources/sniffer';

export default defineBackground(() => {
  // FR-S8: registered in the first turn so the event page wakes for it; a no-op until the user
  // grants the optional webRequest permission (that grant is the opt-in).
  sniffer.sync();
  browser.permissions.onAdded.addListener(() => sniffer.sync());
  browser.permissions.onRemoved.addListener((p) => {
    if (p.permissions?.includes('webRequest')) sniffer.stop();
  });
  browser.tabs.onRemoved.addListener((tabId) => {
    sniffer.store.clear(tabId);
    frames.forget(tabId);
    saveFrames();
  });

  const explain = new ExplainService();

  browser.runtime.onMessage.addListener((msg: unknown, sender) => {
    // Only our own content scripts and pages talk to us.
    if (sender.id !== browser.runtime.id) return undefined;
    return route(msg as BgRequest, sender);
  });

  // FR-A5: all provider traffic goes through this port; the content script never sees keys.
  browser.runtime.onConnect.addListener((port) => {
    if (port.name !== EXPLAIN_PORT || port.sender?.id !== browser.runtime.id) return;
    explain.attach(port);
  });
});
