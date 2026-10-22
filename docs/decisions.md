# Decisions (ADR-lite)

Short records of choices made where the TZ leaves room or reality forced a deviation.

## D-001 TypeScript 6.0, not 7.x

`typescript@latest` is 7.0 (native compiler). `typescript-eslint` (peer `<6.1`) and `svelte-check` (peer `^5 || ^6`)
do not support it yet, so the repo pins `typescript ~6.0`. Revisit when both tools support 7.

## D-002 pnpm virtual store outside the project (Windows only)

The working copy lives under a very long path; esbuild's binary inside `node_modules/.pnpm` exceeded Windows
`MAX_PATH` (260) and could not be spawned. `pnpm-workspace.yaml` sets `virtualStoreDir` to a short path in the
user profile. On a short checkout path (e.g. `C:\dev\subtext`) the line can be removed.

## D-003 Firefox minimum version 140 (TZ says ≥ 128)

Since 2025-11-03 new Firefox extensions must declare `data_collection_permissions` and use Firefox's built-in
consent, which exists from Firefox 140 (desktop). Older versions would need a custom consent flow. Firefox 128 ESR is
out of support by now, so `strict_min_version` is `140.0`. Declared category: `websiteContent` (required) — subtitle
text, which may come from the page's `<track>`, is sent to the AI provider the user configured. Nothing else is
transmitted; there is no telemetry.

## D-004 Test media is a generated WAV, not a video file

No ffmpeg on the dev machine, and the TZ asks for generated or CC0 media. `scripts/gen-fixture-media.mjs` writes
WAV files (8-bit PCM) that Firefox plays inside `<video>`. Tone pulses sit exactly on the cue windows of
`sample.srt`, so sync can be checked by ear. The fixture player paints a gradient behind the transparent video.

## D-005 E2E in real Firefox via WebDriver

`web-ext run` gives a manual session only. For repeatable checks `scripts/e2e.mjs` installs the built zip as a
temporary add-on through Selenium/geckodriver, loads `test/fixtures/*.html` from a local server and takes
screenshots into `.e2e/`. Selenium Manager downloads geckodriver on first run.

## D-007 Default Gemini model and thinking

Checked on 2026-10-22 against ai.google.dev: stable text models are `gemini-3.8-flash` (newest Flash) and
`gemini-3.5-flash-lite` (fastest); 2.0 models are shut down. Default: `gemini-3.8-flash`, with
`generationConfig.thinkingConfig.thinkingLevel: "low"` for Gemini 3+/4 models to keep the first token fast. If a model
rejects the thinking config (HTTP 400 mentioning thinking) the request is retried once without it. The model list in
the options comes from `GET /v1beta/models` (filtered to `generateContent`). The `generateContent` API is used as the
TZ asks (FR-A2), not the newer Interactions API. If first-token latency on the free tier is too high, switch the
default to `gemini-3.5-flash-lite` — that needs a measurement with a real key (not available to the agent).

## D-008 E2E build mode

WebDriver Classic cannot drive privileged `moz-extension://` pages, so options cannot be clicked in tests. `pnpm
build:e2e` (`wxt build --mode e2e`) builds into `.output/firefox-mv3-e2e` with two differences: a window-message hook
on pages (`src/utils/e2e-hooks.ts`, set settings / call background handlers, never secrets) and `http://localhost/*` in
`host_permissions` for the mock provider (`scripts/mock-ai.mjs`). The production build contains neither — the hook is
behind `import.meta.env.MODE === 'e2e'` and is tree-shaken. The options UI itself is covered by component tests and
manual checks.

## D-009 Panel leaves the player's control bar free

A full-height panel covered the site's own controls (fullscreen button, seek bar) on the right. The panel now ends
`clamp(44px, 11%, 84px)` above the bottom of the video. Found by the E2E fullscreen scenario.

## D-010 Selections snap to whole words

A mouse selection that starts or ends inside a word is extended to the word edges before it is sent as `SELECTED`
(each word is its own span, so this is exact). Half-words only confused the model.

## D-011 Offset semantics

`offsetMs` is a display shift: +300 ms shows every cue 300 ms later (`]` when subtitles come too early). Internally the
lookup time is `currentTime − offset`, which is the TZ's `currentTime + offset` with the sign flipped to match the keys.

## D-012 Storage location

IndexedDB (library, explanations cache, phrases, feedback) lives in the background page's origin. A content script's
IndexedDB would belong to the website, so it would be split per site and visible to the site. Content scripts reach it
through typed `runtime.sendMessage` calls.

## D-006 `web-ext lint` warning about `innerHTML`

The only `UNSAFE_VAR_ASSIGNMENT` comes from the Svelte runtime, which builds static templates via `innerHTML` of
compile-time strings. Our code never assigns HTML (ESLint forbids `innerHTML`/`outerHTML` and `{@html}`); model
output is rendered as text nodes with a tiny `**bold**` splitter.
