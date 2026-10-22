import { mount, unmount } from 'svelte';
import Hello from '../ui/Hello.svelte';
import { findVideos, rankVideos } from '../core/player/find-video';

export default defineContentScript({
  matches: ['<all_urls>'],
  allFrames: true,
  runAt: 'document_idle',
  cssInjectionMode: 'ui',

  async main(ctx) {
    const video = rankVideos(findVideos(document))[0];
    if (!video?.parentElement) return;
    const container = video.parentElement;

    const ui = await createShadowRootUi(ctx, {
      name: 'subtext-overlay',
      position: 'inline',
      anchor: container,
      append: 'last',
      onMount: (root) => mount(Hello, { target: root }),
      onRemove: (app) => {
        if (app) void unmount(app);
      },
    });
    ui.mount();
  },
});
