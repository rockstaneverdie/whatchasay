import { ExplainService } from '../core/ai/explain-service';
import { route } from '../core/messaging/bg-router';
import { EXPLAIN_PORT, type BgRequest } from '../core/messaging/types';

export default defineBackground(() => {
  const explain = new ExplainService();

  browser.runtime.onMessage.addListener((msg: unknown, sender) => {
    // Only our own content scripts and pages talk to us.
    if (sender.id !== browser.runtime.id) return undefined;
    return route(msg as BgRequest);
  });

  // FR-A5: all provider traffic goes through this port; the content script never sees keys.
  browser.runtime.onConnect.addListener((port) => {
    if (port.name !== EXPLAIN_PORT || port.sender?.id !== browser.runtime.id) return;
    explain.attach(port);
  });
});
