<script lang="ts">
  import { untrack } from 'svelte';
  import type { MediaInfo } from '../core/subtitles/types';
  import type { OverlayActions } from './actions';
  import type { OverlayState } from './state.svelte';

  interface Props {
    ui: OverlayState;
    actions: OverlayActions;
  }

  let { ui, actions }: Props = $props();

  // A local draft of the current values; written back only on save.
  const initial = untrack(() => ({ ...ui.mediaInfo }));
  let title = $state(initial.title ?? '');
  let season = $state(initial.season?.toString() ?? '');
  let episode = $state(initial.episode?.toString() ?? '');
  let year = $state(initial.year?.toString() ?? '');
  let synopsis = $state(initial.synopsis ?? '');

  const num = (s: string) => {
    const n = Number.parseInt(s, 10);
    return Number.isFinite(n) ? n : undefined;
  };

  function save(e: SubmitEvent) {
    e.preventDefault();
    const info: MediaInfo = {};
    if (title.trim()) info.title = title.trim();
    const s = num(season);
    const ep = num(episode);
    const y = num(year);
    if (s !== undefined) info.season = s;
    if (ep !== undefined) info.episode = ep;
    if (y !== undefined) info.year = y;
    if (synopsis.trim()) info.synopsis = synopsis.trim();
    actions.saveMediaInfo(info);
    ui.mediaFormOpen = false;
  }

  function onKeydown(e: KeyboardEvent) {
    if (e.key === 'Escape') {
      e.preventDefault();
      ui.mediaFormOpen = false;
    }
  }
</script>

<div class="scrim interactive">
  <!-- svelte-ignore a11y_no_noninteractive_element_interactions -->
  <form class="form" aria-labelledby="subtext-media-title" onsubmit={save} onkeydown={onKeydown}>
    <h2 id="subtext-media-title">{ui.t('media.title')}</h2>
    <label>
      <span>{ui.t('media.show')}</span>
      <!-- svelte-ignore a11y_autofocus -->
      <input bind:value={title} autofocus />
    </label>
    <div class="grid">
      <label><span>{ui.t('media.season')}</span><input bind:value={season} inputmode="numeric" /></label>
      <label><span>{ui.t('media.episode')}</span><input bind:value={episode} inputmode="numeric" /></label>
      <label><span>{ui.t('media.year')}</span><input bind:value={year} inputmode="numeric" /></label>
    </div>
    <label>
      <span>{ui.t('media.synopsis')}</span>
      <textarea bind:value={synopsis} rows="3"></textarea>
    </label>
    <div class="actions">
      <button type="button" class="icon-btn" onclick={() => (ui.mediaFormOpen = false)}
        >{ui.t('media.cancel')}</button
      >
      <button type="submit" class="icon-btn primary">{ui.t('media.save')}</button>
    </div>
  </form>
</div>

<style>
  .scrim {
    position: absolute;
    inset: 0;
    display: flex;
    align-items: center;
    justify-content: center;
    background: rgba(0, 0, 0, 0.35);
  }

  .form {
    width: min(92%, 420px);
    padding: 18px;
    border-radius: 16px;
    border: 1px solid var(--hairline);
    background: var(--bg-card);
    box-shadow: var(--shadow);
    display: flex;
    flex-direction: column;
    gap: 10px;
    font-size: 14px;
  }

  h2 {
    margin: 0 0 4px;
    font-size: 17px;
  }

  label {
    display: flex;
    flex-direction: column;
    gap: 4px;
  }

  label span {
    font-size: 12px;
    color: var(--text-muted);
  }

  input,
  textarea {
    padding: 7px 9px;
    border-radius: 8px;
    border: 1px solid var(--hairline);
    background: var(--chip-bg);
    resize: vertical;
  }

  .grid {
    display: grid;
    grid-template-columns: repeat(3, 1fr);
    gap: 8px;
  }

  .actions {
    display: flex;
    justify-content: flex-end;
    gap: 8px;
    margin-top: 4px;
  }

  .primary {
    background: var(--accent);
    color: #fff;
  }
</style>
