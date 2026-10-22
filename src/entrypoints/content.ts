import { SubtextApp } from '../ui/app';
import { ExplainClient } from '../ui/explain-client';
import { SourcesClient } from '../ui/sources-client';
import { installE2EHooks } from '../utils/e2e-hooks';
import { log } from '../utils/log';

export default defineContentScript({
  matches: ['<all_urls>'],
  allFrames: true,
  runAt: 'document_idle',
  // Styles are injected by Svelte into our own shadow root (see svelte.config.js).
  cssInjectionMode: 'manual',

  main(ctx) {
    if (import.meta.env.MODE === 'e2e') installE2EHooks();
    // Nothing is shown until a suitable <video> appears (lazy UI, FR-V4).
    const app = new SubtextApp(ctx);
    const explain = new ExplainClient(app);
    new SourcesClient(app);
    ctx.onInvalidated(() => explain.destroy());
    app.start().catch((e) => log.error('start failed', e));
  },
});
