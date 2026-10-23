<script lang="ts">
  import { SUBTITLE_ENCODINGS, type SubtitleEncoding } from '../core/subtitles/decode';
  import { formatHotkey } from '../core/player/hotkeys';
  import { trackTitle } from '../core/player/page-tracks';
  import type { OverlayActions } from './actions';
  import type { OverlayState } from './state.svelte';

  interface Props {
    ui: OverlayState;
    actions: OverlayActions;
    onPickFile: () => void;
  }

  let { ui, actions, onPickFile }: Props = $props();

  const offsetLabel = $derived(`${ui.offsetMs >= 0 ? '+' : ''}${(ui.offsetMs / 1000).toFixed(1)}`);

  function toggleMenu() {
    ui.menuOpen = !ui.menuOpen;
    if (ui.menuOpen) actions.refreshSniffed();
  }

  function run(fn: () => void) {
    return () => {
      ui.menuOpen = false;
      fn();
    };
  }

  function onEncoding(e: Event) {
    actions.setEncoding((e.currentTarget as HTMLSelectElement).value as SubtitleEncoding | 'auto');
  }

  function onKeydown(e: KeyboardEvent) {
    if (e.key === 'Escape' && ui.menuOpen) {
      e.preventDefault();
      ui.menuOpen = false;
    }
  }
</script>

<div class="launcher interactive" class:left={ui.settings.panel.side === 'left'}>
  <button
    type="button"
    class="fab glass"
    aria-haspopup="menu"
    aria-expanded={ui.menuOpen}
    title={ui.t('launcher.title')}
    onclick={toggleMenu}>S</button
  >

  {#if ui.menuOpen}
    <div class="menu glass" role="menu" tabindex="-1" onkeydown={onKeydown}>
      <button type="button" role="menuitem" onclick={run(onPickFile)}>{ui.t('menu.load')}</button>
      <button type="button" role="menuitem" onclick={run(actions.openSearch)}>{ui.t('menu.search')}</button>

      {#if ui.hasFile}
        <label class="row">
          <span>{ui.t('menu.encoding')}</span>
          <select value={ui.encoding} onchange={onEncoding}>
            <option value="auto">{ui.t('menu.encoding.auto')}</option>
            {#each SUBTITLE_ENCODINGS as enc (enc)}
              <option value={enc}>{enc}</option>
            {/each}
          </select>
        </label>
      {/if}

      {#if ui.sniffActive}
        <div class="group">
          <span class="caption">{ui.t('menu.sniffed')}</span>
          {#if ui.sniffed.length === 0}
            <span class="muted">{ui.t('menu.sniffed.none')}</span>
          {:else}
            {#each ui.sniffed as g (g.key)}
              <button type="button" role="menuitem" onclick={run(() => actions.importSniffed(g.key))}>
                {g.label}{g.lang ? ` · ${g.lang}` : ''}{g.parts > 1
                  ? ` · ${ui.t('menu.sniffed.parts', { n: g.parts })}`
                  : ''}
              </button>
            {/each}
          {/if}
        </div>
      {/if}

      <div class="group">
        <span class="caption">{ui.t('menu.pageTracks')}</span>
        {#if ui.pageTracks.length === 0}
          <span class="muted">{ui.t('menu.pageTracks.none')}</span>
        {:else}
          {#each ui.pageTracks as tr (tr.index)}
            <button type="button" role="menuitem" onclick={run(() => actions.importPageTrack(tr.index))}>
              {trackTitle(tr)}
            </button>
          {/each}
        {/if}
      </div>

      <button type="button" role="menuitem" onclick={run(() => (ui.mediaFormOpen = true))}
        >{ui.t('menu.media')}</button
      >
      <button type="button" role="menuitem" onclick={run(actions.togglePanel)}>
        {ui.t('menu.togglePanel')} <kbd>{formatHotkey(ui.settings.hotkeys.togglePanel)}</kbd>
      </button>
      <label class="row">
        <span>{ui.t('menu.compact')}</span>
        <select
          value={ui.settings.panel.compact}
          onchange={(e) =>
            actions.setCompact((e.currentTarget as HTMLSelectElement).value as 'auto' | 'on' | 'off')}
        >
          <option value="auto">auto</option>
          <option value="on">on</option>
          <option value="off">off</option>
        </select>
      </label>

      {#if ui.track}
        <div class="row">
          <span>{ui.t('menu.offset')}</span>
          <span class="offset">
            <button type="button" class="mini" onclick={() => actions.nudgeOffset(-100)} aria-label="−100 ms"
              >−</button
            >
            <output>{offsetLabel}</output>
            <button type="button" class="mini" onclick={() => actions.nudgeOffset(100)} aria-label="+100 ms"
              >+</button
            >
          </span>
        </div>
      {/if}

      {#if ui.videos.length > 1}
        <div class="group">
          <span class="caption">{ui.t('menu.video')}</span>
          {#each ui.videos as v (v.index)}
            <button
              type="button"
              role="menuitemradio"
              aria-checked={v.current}
              onclick={run(() => actions.selectVideo(v.index))}
            >
              {v.current ? '● ' : ''}{ui.t('menu.video.item', {
                n: v.index + 1,
                w: Math.round(v.width),
                h: Math.round(v.height),
              })}
            </button>
          {/each}
        </div>
      {/if}

      <button type="button" role="menuitem" onclick={run(actions.openSettings)}
        >{ui.t('menu.settings')}</button
      >
    </div>
  {/if}
</div>

<style>
  .launcher {
    position: absolute;
    top: 12px;
    left: 12px;
    font-size: 14px;
  }

  .launcher.left {
    left: auto;
    right: 12px;
  }

  .fab {
    width: 38px;
    height: 38px;
    border: 1px solid var(--hairline);
    border-radius: 50%;
    font-weight: 800;
    font-size: 17px;
    cursor: pointer;
    box-shadow: var(--shadow);
  }

  .menu {
    margin-top: 8px;
    min-width: 250px;
    max-height: calc(100cqh - 80px);
    overflow: auto;
    padding: 6px;
    border: 1px solid var(--hairline);
    border-radius: 14px;
    background: var(--bg-card);
    box-shadow: var(--shadow);
    display: flex;
    flex-direction: column;
    gap: 2px;
  }

  .menu > button,
  .group > button {
    display: block;
    width: 100%;
    text-align: left;
    padding: 7px 10px;
    border: 0;
    border-radius: 8px;
    background: transparent;
    cursor: pointer;
  }

  .menu > button:hover,
  .group > button:hover {
    background: var(--chip-bg);
  }

  .row {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: 10px;
    padding: 5px 10px;
  }

  select {
    background: var(--chip-bg);
    border: 1px solid var(--hairline);
    border-radius: 6px;
    padding: 2px 4px;
  }

  select option {
    color: #111;
  }

  .group {
    display: flex;
    flex-direction: column;
    padding: 4px 0;
    border-top: 1px solid var(--hairline);
    border-bottom: 1px solid var(--hairline);
  }

  .caption {
    padding: 2px 10px;
    font-size: 11px;
    text-transform: uppercase;
    letter-spacing: 0.06em;
    color: var(--text-muted);
  }

  .muted {
    padding: 4px 10px;
    color: var(--text-muted);
    font-size: 13px;
  }

  .offset {
    display: inline-flex;
    align-items: center;
    gap: 6px;
    font-variant-numeric: tabular-nums;
  }

  .mini {
    width: 24px;
    height: 24px;
    border: 0;
    border-radius: 50%;
    background: var(--chip-bg);
    cursor: pointer;
  }

  kbd {
    float: right;
    font-size: 11px;
    color: var(--text-muted);
    font-family: inherit;
  }
</style>
