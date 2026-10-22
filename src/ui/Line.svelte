<script lang="ts">
  import type { Cue } from '../core/subtitles/types';
  import { tokenizeLines, wordProgress, wordTimings } from '../core/subtitles/word-timing';
  import { formatTime, lineStyle } from './line-style';
  import type { OverlayState } from './state.svelte';

  interface Props {
    cue: Cue;
    index: number;
    /** Signed distance from the focused cue; 0 for every active cue. */
    distance: number;
    active: boolean;
    ui: OverlayState;
  }

  let { cue, index, distance, active, ui }: Props = $props();

  /** Display rows of words with their flat index (the index into the word timings). */
  const words = $derived.by(() => {
    let i = 0;
    return tokenizeLines(cue.lines).map((row) => row.map((text) => ({ text, i: i++ })));
  });
  // Word timings (and the per-frame clock) are only touched by active speech lines.
  const timings = $derived(active && cue.kind === 'speech' ? wordTimings(cue) : null);
  const look = $derived(lineStyle(distance, ui.reducedMotion));

  function progress(i: number): string | null {
    const w = timings?.[i];
    return w ? wordProgress(w, ui.time).toFixed(3) : null;
  }
</script>

<div
  class="line"
  class:active
  class:aux={cue.kind !== 'speech'}
  class:karaoke={timings !== null}
  data-index={index}
  data-cue-id={cue.id}
  role="listitem"
  style={look}
>
  <button
    type="button"
    class="ts"
    data-seek={index}
    tabindex="-1"
    aria-label={ui.t('line.seek', { time: formatTime(cue.start) })}>{formatTime(cue.start)}</button
  >
  {#if cue.speaker}<span class="speaker">{cue.speaker}</span>{/if}
  {#each words as row, r (r)}
    <span class="row">
      {#each row as word (word.i)}
        <span class="w" data-w={word.i} style:--p={progress(word.i)}>{word.text}</span>
        <!-- Real spaces, so a selection copies as normal text. -->
        <!-- eslint-disable-next-line svelte/no-useless-mustaches -->
        {' '}
      {/each}
    </span>
  {/each}
</div>

<style>
  .line {
    position: relative;
    margin: 0 0 var(--gap-lines);
    padding-right: 1.4em;
    font-weight: var(--weight-idle);
    opacity: var(--o);
    transform: scale(var(--s));
    transform-origin: left center;
    filter: var(--f);
    transition:
      opacity var(--dur) var(--ease),
      transform var(--dur) var(--ease),
      filter var(--dur) var(--ease);
    cursor: pointer;
    overflow-wrap: anywhere;
    max-height: 60cqh;
    overflow: hidden;
    user-select: text;
  }

  .line.active {
    font-weight: var(--weight-active);
  }

  .row {
    display: block;
  }

  .speaker {
    display: block;
    font-size: 0.42em;
    font-weight: 700;
    letter-spacing: 0.08em;
    text-transform: uppercase;
    color: var(--text-muted);
    margin-bottom: 0.15em;
  }

  .aux {
    font-size: 0.55em;
    font-style: italic;
    font-weight: 500;
    color: var(--text-muted);
    cursor: default;
  }

  .w {
    border-radius: 0.15em;
  }

  .line:not(.aux) .w:hover {
    text-decoration: underline dotted 0.06em;
    text-underline-offset: 0.18em;
  }

  /* 7.4: words fill left to right; before start 0.45 white, after 1. */
  .karaoke .w {
    color: transparent;
    background-image: linear-gradient(
      90deg,
      var(--text) calc(var(--p, 0) * 100% - 0.08em),
      var(--text-dim) calc(var(--p, 0) * 100% + 0.08em)
    );
    -webkit-background-clip: text;
    background-clip: text;
  }

  .ts {
    position: absolute;
    right: 0;
    top: 0.2em;
    padding: 0.1em 0.3em;
    border: 0;
    border-radius: 0.4em;
    background: var(--chip-bg);
    font-size: 0.38em;
    font-weight: 600;
    font-variant-numeric: tabular-nums;
    opacity: 0;
    cursor: pointer;
    transition: opacity 150ms;
  }

  .line:hover .ts,
  .ts:focus-visible {
    opacity: 0.85;
  }
</style>
