import { svelte } from '@sveltejs/vite-plugin-svelte';
import { defineConfig } from 'vitest/config';
import { WxtVitest } from 'wxt/testing/vitest-plugin';

export default defineConfig({
  plugins: [WxtVitest(), svelte()],
  resolve: { conditions: ['browser'] },
  test: {
    globals: true,
    environment: 'happy-dom',
    include: ['test/unit/**/*.test.ts'],
    setupFiles: ['test/setup.ts'],
    restoreMocks: true,
  },
});
