import { vitePreprocess } from '@sveltejs/vite-plugin-svelte';

export default {
  preprocess: vitePreprocess(),
  // Used by svelte-check, ESLint and Vitest; the build gets the same options from wxt.config.ts.
  compilerOptions: { runes: true, css: 'injected' },
};
