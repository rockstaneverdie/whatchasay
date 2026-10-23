# WhatchaSay?

Firefox extension: a karaoke-style subtitle panel over any HTML5 `<video>`, plus an AI that explains slang, idioms,
wordplay and references **in the context of the scene**. Click a word or a line (or select a fragment) — the video
pauses and a short card explains it; press Space to continue.

Spec: [docs/TZ.md](docs/TZ.md) · decisions: [docs/decisions.md](docs/decisions.md) · ideas parked:
[docs/proposals.md](docs/proposals.md).

## Requirements

- Node.js 24, pnpm 12, Firefox ≥ 140 (desktop).

## Commands

| command               | what it does                                                                                |
| --------------------- | ------------------------------------------------------------------------------------------- |
| `pnpm install`        | dependencies (+ `wxt prepare`)                                                              |
| `pnpm dev`            | dev build with reload in Firefox                                                            |
| `pnpm build`          | production build → `.output/firefox-mv3`                                                    |
| `pnpm zip`            | `.output/whatchasay-<version>-firefox.zip`                                                  |
| `pnpm lint`           | ESLint + Prettier check + svelte-check                                                      |
| `pnpm test`           | Vitest unit and component tests                                                             |
| `pnpm web-ext:lint`   | `web-ext lint` on the production build                                                      |
| `pnpm fixtures:media` | generates test media (`test/fixtures/media`, not in git)                                    |
| `pnpm fixtures`       | serves `test/fixtures` on http://localhost:5555                                             |
| `pnpm web-ext:run`    | opens Firefox with the built extension on the fixture player (run `pnpm fixtures` too)      |
| `pnpm e2e [prefix…]`  | builds the e2e variant and runs WebDriver scenarios in real Firefox, screenshots in `.e2e/` |
| `pnpm e2e live`       | live check on a real legal site (Wikimedia Commons, Sintel CC-BY); needs the internet       |
| `pnpm eval`           | prompt quality eval, see below                                                              |

## Trying it

1. `pnpm install && pnpm build && pnpm fixtures:media`
2. In one terminal `pnpm fixtures`, in another `pnpm web-ext:run`.
3. On the fixture player drop `test/fixtures/sample.srt` (or `.vtt`) onto the video.
4. Settings (toolbar icon → Settings, or the **S** button on the video → Settings): paste a Gemini key
   (free at aistudio.google.com → Get API key), press **Check**.
5. Click a word in the panel. Space continues, Esc closes.

Hotkeys (configurable): `Alt+L` panel, `E` explain current line, `R` replay line, `[` / `]` offset ±100 ms (Shift: ±1 s).

## Layout

```
src/
  entrypoints/   background.ts, content.ts, options/, popup/, upload/
  core/
    subtitles/   decode, parse (SRT/VTT), normalize, word-timing, media-info, track
    player/      find-video, video-watcher, clock (active cue), hotkeys, page-tracks
    ai/          types, prompt, context, sse, response-parser, queue, providers, explain-service, cache-key
    storage/     settings, secrets, idb, library, cache, phrases
    messaging/   typed content ↔ background messages, router
  ui/            Overlay, Panel, Line, Card, Launcher, MediaForm, Toast, CompactBar, host (shadow DOM), app
  i18n/          ru.json, en.json (overlay), pages.ts (options/popup)
test/            unit + component tests, fixtures (all texts are invented)
eval/            cases.json (43 invented cases), run.ts
scripts/         fixture server/media, mock AI server, WebDriver E2E
```

## Privacy

No telemetry. API keys live in `browser.storage.local` and are only read by the background. When you ask for an
explanation, the chosen AI provider receives the show info you entered, the episode subtitle text (or a window of it)
and the selected line/words. Video and audio are never sent anywhere.

## Eval

```
GEMINI_API_KEY=… pnpm eval                 # Gemini, default model
EVAL_PROVIDER=openai OPENAI_BASE_URL=http://localhost:11434/v1 OPENAI_MODEL=llama3.2 pnpm eval
pnpm eval --mock                           # pipeline dry run, no network
```

Prints a table (format kept, length, no spoiler/injection leak, type, confidence) and writes `eval/reports/<time>.md`
with every answer next to the expected gist for manual review.
