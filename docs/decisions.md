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

## D-006 `web-ext lint` warning about `innerHTML`

The only `UNSAFE_VAR_ASSIGNMENT` comes from the Svelte runtime, which builds static templates via `innerHTML` of
compile-time strings. Our code never assigns HTML (ESLint forbids `innerHTML`/`outerHTML` and `{@html}`); model
output is rendered as text nodes with a tiny `**bold**` splitter.
