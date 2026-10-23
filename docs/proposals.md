# Proposals (out of scope for now)

Ideas noticed while implementing M0–M3. Not built — the TZ wins until the owner decides otherwise.

1. **Explicit Gemini context caching.** Implicit caching already benefits from the stable prefix (FR-C1). For long
   episodes, creating a `cachedContents` entry per episode would make repeat requests cheaper and faster. Needs a
   lifetime policy and costs a request; measure first.
2. **Keyboard navigation of lines.** Today keyboard users explain the current line with `E`. Arrow keys to move a
   focus ring through lines and Enter to explain would complete NFR-7.
3. **Measure first-token latency per model.** NFR-2 asks for p50 ≤ 1.5 s on Gemini Flash. A small script that runs
   ten requests per model (`gemini-3.8-flash` with low thinking vs `gemini-3.5-flash-lite`) would settle the default
   model (D-007).
4. **Card position preference.** When there is no room above the phrase the card flips below and can cover the next
   lines. An option "card at the top of the video" could suit small players.
5. **Auto-pick the language of page tracks.** When a page has several `<track>`s, prefer the one whose language
   matches the video's original language (needs a heuristic; keep the manual choice).
6. **Hide the player's own captions while ours are shown.** On Commons the site keeps rendering its English
   captions under our panel/compact line, so the text appears twice. An opt-in "hide page captions while WhatchaSay?
   shows subtitles" (switching the page track to `hidden` and restoring it) would fix that; it changes the site's
   player state, so it should be the user's choice.
7. **Revisit the compact threshold.** Typical embedded players are ~900 px wide, where a 34 % panel is just under
   320 px, so 7.7 picks compact mode. The side panel still read fine at 305 px in the live test; a 280 px threshold or
   a per-site memory of the user's choice may suit better. Needs the owner's call (it changes 7.7).
