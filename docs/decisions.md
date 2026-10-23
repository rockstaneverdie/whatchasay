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

## D-013 OpenSubtitles: user key, unofficial contract check, opt-in sniffing (M4)

The TZ asks for the user's own OpenSubtitles key (BYOK). OpenSubtitles recommends one developer key per application;
if that becomes a problem for the store listing, the owner decides between BYOK and an app key behind a proxy (M6).
The API reference (Stoplight) only renders in a browser, so the contract — `Api-Key` + `User-Agent` headers,
`/subtitles` with sorted lower-case parameters, two-step `/download`, `/login` token, `406` for an exhausted download
quota — was taken from secondary sources and is exercised against `scripts/mock-opensubtitles.mjs`. Firefox does let an
extension set `User-Agent` on `fetch` (checked in E2E). Not yet checked against the real API with a real key.

Page-loaded subtitle files (FR-S8) are spotted from response headers only, behind the optional `webRequest`
permission: granting it in the "Sources" tab is the opt-in, revoking it turns the feature off. The listener is
registered in the background's first turn so the event page wakes for it. HLS `X-TIMESTAMP-MAP` is not applied;
segmented captions use their cue times as written.

## D-014 Product renamed to "WhatchaSay?"; technical ids unchanged

Everything a user sees (manifest name, UI, prompt persona, `User-Agent`, log prefix, export file names, README) says
WhatchaSay?. Internal ids stay as they were so local data survives: the add-on id `subtext@subtext-extension.invalid`,
the IndexedDB name `subtext`, the shadow host tag `subtext-overlay`, the explain port name. The add-on id should be
replaced with a final one before the first AMO upload (M6) — after that it can never change. `PROMPT_VERSION` was
bumped because the persona name is part of the prompt.

## D-015 Third-party players in the TZ (v1.1)

The owner asked that the extension work on third-party video players, including unofficial sites. It is site-agnostic
already, so the TZ now requires robust generic support for third-party and embedded players (FR-V5…V10, M4b) without
naming illegal sources as a target: the TZ's own 3.3 and Mozilla's add-on policies rule out positioning the product for
unlicensed content, and that would put the AMO listing at risk. Testing is done on legal sites only.

## D-016 Live test on a real third-party player (Wikimedia Commons, 2026-10-23)

`pnpm e2e live` runs `scripts/e2e-live.mjs` against Sintel (Blender Foundation, CC-BY) on Wikimedia Commons: a poster
player that opens a video.js player in a modal, 43 page subtitle tracks, captions fetched from `api.php`. AI answers
come from the local mock. Passed: overlay follows the real player, page tracks listed, the page-loaded VTT spotted
(FR-S8), English track imported (26 cues), compact mode on the 898 px player (7.7), side panel in sync with the page's
own captions (10 of 11 samples with a cue agreed; the other fell on a cue boundary), word click pauses, card streams,
Space resumes, panel visible in video.js fullscreen.

Three bugs found there and fixed, each with a local regression test:

1. A player inserted paused next to a poster `<video>` and started later never received the overlay — the watcher
   only re-ranked when the order changed. Now every `play` event lets the app choose again (`m4b-lazy-player-swap`).
2. Track labels wrapped in bidi controls (`English \u202A(en)\u202C`) displayed the language twice and broke matching.
   Labels are cleaned; the language is added only when the label lacks it.
3. Tracks imported from page tracks, OpenSubtitles or page-loaded files were never saved to the library
   (`DataCloneError`: a Svelte state proxy in the message), so a reload lost them. `sendBg` now sends plain data;
   `m3-page-track-import` reloads and checks the restore.

## D-017 Third-party and embedded players (M4b, FR-V5…V10)

All of it stays generic: no host names, selectors or player-specific code.

- **Early start (FR-V8).** The content script runs at `document_start` in every frame, so our capturing key listeners
  are registered before a page's own; a site's window-level Space handler no longer wins
  (`m4b-layered-player`).
- **Hotkeys across frames (FR-V5).** Each frame reports `{hasVideo, hasTrack, cardOpen}` to the background
  (`frames/state`, debounced, only on change). The registry is kept in `storage.session` so it survives the event page
  going to sleep. A key pressed in a frame without a player is routed with the same pure `routeKey` and relayed
  (`hotkey/relay`) to the best frame via `tabs.sendMessage` with `frameId` (card > track > video, lowest id on ties).
  Keys typed into editable fields are never touched. The relay carries the key code and modifiers only.
- **Shadow DOM (FR-V6).** Videos are searched through open shadow roots; ancestry and fullscreen checks use the
  composed tree. Closed shadow roots are not entered: `openOrClosedShadowRoot` is used only to tell the popup that a
  player exists that we cannot reach (`popup.closedPlayer`), never to mount into it.
- **Layers above the video (FR-V7).** After attaching and every couple of seconds the host hit-tests two points (the
  launcher and the panel area). If another layer covers them, the host moves up to the lowest common ancestor shared
  with that layer, at most 4 steps, and never to `body`/`html` or to an element much larger than the video. Checked
  with real WebDriver clicks over a full-size click catcher.
- **Fullscreen (FR-V10).** Nothing can be drawn over a `<video>` that is itself fullscreen, so the menu offers "Full
  screen with subtitles", which makes the player container fullscreen instead. When the user leaves fullscreen of the
  bare video, a toast offers that mode once. A fullscreen element inside a shadow root is resolved through that root.
- **New episode in the same element (FR-V9).** Signals: `src`/`currentSrc` change (blob URLs included), a pathname
  change (SPA, polled every second), and a duration jump (> 5 %, previous duration stable ≥ 10 s, position ≤ 5 s,
  new duration > 30 s). Title changes alone are ignored — sites rewrite titles constantly. If the source changed but
  the media key did not (the same page URL), the track is cleared with a "new video" toast and is not restored from
  the library, otherwise the previous episode's subtitles would come back.
- **Live checks.** `pnpm e2e live` also opens a local page that embeds Big Buck Bunny (CC-BY) from Vimeo: overlay
  mounted inside the cross-origin frame and lifted above the player's own UI, offset and Alt+L pressed on the parent page
  reached the frame, the parent did not scroll. The srt is passed from Node because the provider's CSP blocks fetches to
  localhost. The archive.org embed could not be checked: the connection is reset from this network.

## D-018 Custom-tag players and frames without a URL (2026-10-23)

The owner supplied a structure dump of a widespread commercial HTML5 player. `players/custom-tag-player.html` copies that
structure:

- the video sits in layers of an unknown element (`pjsdiv`);
- `<video preload="none" crossorigin="anonymous">` plays a `blob:` source;
- an empty `<iframe>` lies over the picture;
- the player handles keys on `document`, goes fullscreen on its own box, and switches episodes in the same `<video>`.

The extension still has no code for any particular player. The fixture runs in three variants: in the page, inside an
`<iframe>` with no `src` that the page builds from script, and inside a `srcdoc` iframe.

Found and fixed:

1. **Frames without a URL had no content script.** The content script now uses `match_about_blank`. Those frames have
   no URL or title of their own, so the media key and episode detection use the inherited base URL and the parent's
   title (`utils/page.ts`). The library entry belongs to the page, not to `about:blank`. Cost: the script now also
   starts in empty ad or utility frames. It reads settings and sends one message there; the UI stays lazy.
2. **Stale frame state after navigation broke hotkey forwarding** (intermittent). The `pagehide` report from the
   previous page does not always arrive, so the registry could still list the old top frame as the player. Hotkeys
   from the new top frame were then "forwarded" to itself and dropped. Every content script now announces its new
   document first, before anything awaits (`frames/get`). The background drops that frame's old entry, or the whole tab
   when it is the top frame.

Checked without changes: the overlay stays above the player's layers (no lift needed there), the site's own keys
(arrows) still work, our Space with a card open never reaches the site, the panel shows in the site's fullscreen, a
reload restores the track despite a new `blob:` URL, and a new episode resets the track.

Not covered:

- **MediaSource.** The fixture feeds a whole-file `blob:` rather than a MediaSource: there is no encoder here to make
  segments. The extension sees MediaSource only through `src`/`currentSrc`/`duration`, which this covers.
- **Live check.** No legal public page with this player was found without signing up. The player's vendor site shows
  only images of its skins.

## D-019 Final add-on id and signed self-distribution (2026-10-23)

For a permanent install in release Firefox the owner chose Mozilla signing on the unlisted channel (no store listing)
and the final id `whatchasay@rocksta.dev`. Mozilla binds the id to the owner's account at the first signing, and it can
never change afterwards. This replaces the placeholder from D-014. Data stored under the old id (settings, the AI key in
`storage.local`) does not carry over to the signed add-on; IndexedDB names are unaffected but live under the new
add-on's origin, so the library and cache start empty too.

`pnpm sign` (`scripts/sign.mjs`):

- builds the production zip and its source archive (the bundle is minified, so reviewers may ask for sources);
- runs `web-ext lint`;
- calls `web-ext sign --channel unlisted --upload-source-code`.

The API credentials come from the environment or a git-ignored `.env`. web-ext reads them from the environment, so they
never appear on a command line or in output. WXT's source archive does not follow `.gitignore`, so `.env*`, test media,
screenshots and reports are excluded explicitly in `wxt.config.ts`; this was checked by building with a dummy `.env`.
