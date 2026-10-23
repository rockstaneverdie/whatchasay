import js from '@eslint/js';
import svelte from 'eslint-plugin-svelte';
import globals from 'globals';
import ts from 'typescript-eslint';
import svelteConfig from './svelte.config.js';

export default ts.config(
  { ignores: ['.output/', '.wxt/', 'node_modules/', 'test/fixtures/', 'eval/reports/'] },
  js.configs.recommended,
  ...ts.configs.recommended,
  ...svelte.configs.recommended,
  {
    languageOptions: {
      globals: { ...globals.browser, ...globals.node, ...globals.webextensions },
    },
    rules: {
      // NFR-4: no dynamic code and no raw HTML from outside data.
      'no-eval': 'error',
      'no-implied-eval': 'error',
      'no-new-func': 'error',
      'svelte/no-at-html-tags': 'error',
      '@typescript-eslint/no-unused-vars': ['error', { argsIgnorePattern: '^_', varsIgnorePattern: '^_' }],
      'no-restricted-properties': [
        'error',
        { property: 'innerHTML', message: 'Render external data with textContent (NFR-4).' },
        { property: 'outerHTML', message: 'Render external data with textContent (NFR-4).' },
      ],
    },
  },
  {
    files: ['**/*.svelte', '**/*.svelte.ts'],
    languageOptions: {
      parserOptions: {
        projectService: true,
        extraFileExtensions: ['.svelte'],
        parser: ts.parser,
        svelteConfig,
      },
    },
  },
  {
    // Tests build their own DOM fixtures; NFR-4 is about product code rendering outside data.
    files: ['test/**'],
    rules: { 'no-restricted-properties': 'off' },
  },
  {
    // Auto-imported by WXT.
    languageOptions: {
      globals: {
        defineBackground: 'readonly',
        defineContentScript: 'readonly',
        createShadowRootUi: 'readonly',
        browser: 'readonly',
      },
    },
  },
);
