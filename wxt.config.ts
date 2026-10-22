import { defineConfig } from 'wxt';

export default defineConfig({
  srcDir: 'src',
  modules: ['@wxt-dev/module-svelte'],
  // The module ignores svelte.config.js. `css: 'injected'` appends component CSS to the shadow
  // root a component is mounted in, so the content script needs no web-accessible stylesheet.
  svelte: { vite: { compilerOptions: { runes: true, css: 'injected' } } },
  manifestVersion: 3,
  manifest: ({ mode }) => ({
    name: 'Subtext',
    description: 'A language-learning tool for watching videos with subtitles.',
    // E2E builds get webRequest up front: tests cannot click the permission grant (see D-008).
    permissions: ['storage', ...(mode === 'e2e' ? ['webRequest'] : [])],
    // FR-S8 opt-in: spotting subtitle files the page loads. Granted without a prompt in Firefox.
    optional_permissions: mode === 'e2e' ? [] : ['webRequest'],
    host_permissions: [
      'https://generativelanguage.googleapis.com/*',
      'https://api.groq.com/*',
      // E2E builds talk to a local mock provider without the permission prompt.
      ...(mode === 'e2e' ? ['http://localhost/*'] : []),
    ],
    // Custom AI hosts (FR-A3), OpenSubtitles (FR-S7) and, for interception, all sites (FR-S8).
    optional_host_permissions: ['http://localhost/*', 'http://127.0.0.1/*', 'https://*/*', '<all_urls>'],
    action: { default_title: 'Subtext' },
    browser_specific_settings: {
      gecko: {
        id: 'subtext@subtext-extension.invalid',
        // 140: built-in data-collection consent (see docs/decisions.md, D-003).
        strict_min_version: '140.0',
        // Subtitle text (possibly from the page's <track>) goes to the AI provider the user picked.
        data_collection_permissions: { required: ['websiteContent'] },
      },
      // Desktop is the target; this only keeps Android's minimum consistent with the consent API.
      gecko_android: { strict_min_version: '142.0' },
    },
  }),
});
