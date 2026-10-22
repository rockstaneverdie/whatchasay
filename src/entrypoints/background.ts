import { route } from '../core/messaging/bg-router';
import type { BgRequest } from '../core/messaging/types';

export default defineBackground(() => {
  browser.runtime.onMessage.addListener((msg: unknown, sender) => {
    // Only our own content scripts and pages talk to us.
    if (sender.id !== browser.runtime.id) return undefined;
    return route(msg as BgRequest);
  });
});
