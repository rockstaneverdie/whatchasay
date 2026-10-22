import { SubtextApp } from '../ui/app';
import { log } from '../utils/log';

export default defineContentScript({
  matches: ['<all_urls>'],
  allFrames: true,
  runAt: 'document_idle',
  // Styles are injected by Svelte into our own shadow root (see svelte.config.js).
  cssInjectionMode: 'manual',

  main(ctx) {
    // Nothing is shown until a suitable <video> appears (lazy UI, FR-V4).
    const app = new SubtextApp(ctx);
    app.start().catch((e) => log.error('start failed', e));
  },
});
