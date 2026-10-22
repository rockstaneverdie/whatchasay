<script lang="ts">
  import { untrack } from 'svelte';
  import type { SourceFailure } from '../core/messaging/types';
  import type { OsResult } from '../core/sources/opensubtitles';
  import { guessMediaInfo } from '../core/subtitles/media-info';
  import type { MessageKey } from '../i18n';
  import type { OverlayActions } from './actions';
  import type { OverlayState } from './state.svelte';

  interface Props {
    ui: OverlayState;
    actions: OverlayActions;
  }

  let { ui, actions }: Props = $props();

  // FR-S7: prefilled from "What are we watching?", else from the page title.
  const initial = untrack(() => {
    const m = ui.mediaInfo.title ? ui.mediaInfo : guessMediaInfo(undefined, document.title);
    return { ...m, langs: ui.settings.sources.osLanguages };
  });
  let query = $state(initial.title ?? '');
  let season = $state(initial.season?.toString() ?? '');
  let episode = $state(initial.episode?.toString() ?? '');
  let langs = $state(initial.langs);
  let status = $state<'idle' | 'searching' | 'results' | 'loading' | 'error'>('idle');
  let results = $state.raw<OsResult[]>([]);
  let error = $state<Pick<SourceFailure, 'code' | 'message' | 'retryAfter'> | null>(null);
  let loadingId = $state<number | null>(null);

  const num = (s: string) => {
    const n = Number.parseInt(s, 10);
    return Number.isFinite(n) ? n : undefined;
  };

  async function search(e: SubmitEvent) {
    e.preventDefault();
    status = 'searching';
    error = null;
    const s = num(season);
    const ep = num(episode);
    const r = await actions.osSearch({
      query,
      languages: langs,
      ...(s !== undefined ? { season: s } : {}),
      ...(ep !== undefined ? { episode: ep } : {}),
    });
    if (r.ok) {
      results = r.results;
      status = 'results';
    } else {
      error = r;
      status = 'error';
    }
  }

  async function pick(r: OsResult) {
    loadingId = r.fileId;
    status = 'loading';
    try {
      await actions.osLoad(r);
      ui.searchOpen = false;
    } catch (e) {
      const err = e as Error & { code?: SourceFailure['code']; retryAfter?: number };
      error = {
        code: err.code ?? 'unknown',
        message: err.message,
        ...(err.retryAfter ? { retryAfter: err.retryAfter } : {}),
      };
      status = 'error';
    } finally {
      loadingId = null;
    }
  }

  function errorText(): string {
    if (!error) return '';
    const key = `os.error.${error.code}` as MessageKey;
    const known = ui.t(key);
    return known === key ? `${ui.t('os.error.unknown')} (${error.message})` : known;
  }

  function onKeydown(e: KeyboardEvent) {
    if (e.key === 'Escape') {
      e.preventDefault();
      ui.searchOpen = false;
    }
  }
</script>

<div class="scrim interactive">
  <div class="dialog" role="dialog" aria-labelledby="subtext-os-title" tabindex="-1" onkeydown={onKeydown}>
    <header>
      <h2 id="subtext-os-title">{ui.t('os.title')}</h2>
      <button type="button" class="x" aria-label={ui.t('card.close')} onclick={() => (ui.searchOpen = false)}
        >×</button
      >
    </header>
    <form onsubmit={search}>
      <label class="wide">
        <span>{ui.t('media.show')}</span>
        <!-- svelte-ignore a11y_autofocus -->
        <input bind:value={query} autofocus />
      </label>
      <label><span>{ui.t('media.season')}</span><input bind:value={season} inputmode="numeric" /></label>
      <label><span>{ui.t('media.episode')}</span><input bind:value={episode} inputmode="numeric" /></label>
      <label><span>{ui.t('os.languages')}</span><input bind:value={langs} spellcheck="false" /></label>
      <button type="submit" class="primary" disabled={status === 'searching' || status === 'loading'}
        >{ui.t('os.search')}</button
      >
    </form>

    <div class="body" aria-live="polite">
      {#if status === 'searching'}
        <p class="muted">{ui.t('os.searching')}</p>
      {:else if status === 'error'}
        <p class="error">{errorText()}</p>
        {#if error?.code === 'no-key' || error?.code === 'bad-key' || error?.code === 'no-permission'}
          <button type="button" class="primary" onclick={actions.openSettings}
            >{ui.t('error.openSettings')}</button
          >
        {/if}
      {:else if status === 'results' || status === 'loading'}
        {#if results.length === 0}
          <p class="muted">{ui.t('os.empty')}</p>
        {:else}
          <ul>
            {#each results as r (r.fileId)}
              <li>
                <button type="button" class="result" disabled={status === 'loading'} onclick={() => pick(r)}>
                  <span class="name">{r.release || r.fileName}</span>
                  <span class="meta">
                    <span class="lang">{r.language}</span>
                    {#if r.media.season != null}S{r.media.season}E{r.media.episode ?? '?'} ·{/if}
                    ↓ {r.downloads}
                    {#if r.fps}· {r.fps} fps{/if}
                    {#if r.hearingImpaired}· HI{/if}
                    {#if r.machineTranslated}· {ui.t('os.machine')}{/if}
                    {#if loadingId === r.fileId}· {ui.t('os.loading')}{/if}
                  </span>
                </button>
              </li>
            {/each}
          </ul>
        {/if}
      {/if}
    </div>
    <p class="note">{ui.t('os.privacy')}</p>
  </div>
</div>

<style>
  .scrim {
    position: absolute;
    inset: 0;
    display: flex;
    align-items: center;
    justify-content: center;
    background: rgba(0, 0, 0, 0.4);
  }

  .dialog {
    width: min(94%, 560px);
    max-height: calc(100cqh - 24px);
    display: flex;
    flex-direction: column;
    padding: 14px 16px;
    border-radius: 16px;
    border: 1px solid var(--hairline);
    background: var(--bg-card);
    box-shadow: var(--shadow);
    font-size: 14px;
  }

  header {
    display: flex;
    align-items: center;
    justify-content: space-between;
  }

  h2 {
    margin: 0 0 8px;
    font-size: 17px;
  }

  .x {
    border: 0;
    background: none;
    font-size: 20px;
    cursor: pointer;
    color: var(--text-muted);
  }

  form {
    display: grid;
    grid-template-columns: repeat(3, minmax(0, 1fr)) auto;
    gap: 8px;
    align-items: end;
  }

  label {
    display: flex;
    flex-direction: column;
    gap: 3px;
  }

  label.wide {
    grid-column: 1 / -1;
  }

  label span {
    font-size: 12px;
    color: var(--text-muted);
  }

  input {
    width: 100%;
    min-width: 0;
    padding: 6px 8px;
    border-radius: 8px;
    border: 1px solid var(--hairline);
    background: var(--chip-bg);
  }

  .primary {
    padding: 7px 14px;
    border: 0;
    border-radius: 999px;
    background: var(--accent);
    color: #fff;
    font-weight: 600;
    cursor: pointer;
  }

  .primary:disabled,
  .result:disabled {
    opacity: 0.6;
    cursor: default;
  }

  .body {
    margin-top: 10px;
    overflow: auto;
    min-height: 40px;
  }

  ul {
    list-style: none;
    margin: 0;
    padding: 0;
  }

  .result {
    display: flex;
    flex-direction: column;
    align-items: flex-start;
    gap: 2px;
    width: 100%;
    padding: 7px 8px;
    border: 0;
    border-radius: 8px;
    background: transparent;
    text-align: left;
    cursor: pointer;
  }

  .result:hover:not(:disabled) {
    background: var(--chip-bg);
  }

  .name {
    font-weight: 600;
    overflow-wrap: anywhere;
  }

  .meta {
    font-size: 12px;
    color: var(--text-muted);
  }

  .lang {
    text-transform: uppercase;
    font-weight: 700;
  }

  .muted {
    color: var(--text-muted);
  }

  .error {
    margin: 0 0 8px;
  }

  .note {
    margin: 10px 0 0;
    font-size: 11px;
    color: var(--text-muted);
  }
</style>
