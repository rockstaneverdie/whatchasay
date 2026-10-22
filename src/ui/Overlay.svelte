<script lang="ts">
  import Card from './Card.svelte';
  import CompactBar from './CompactBar.svelte';
  import Launcher from './Launcher.svelte';
  import MediaForm from './MediaForm.svelte';
  import SearchDialog from './SearchDialog.svelte';
  import Panel from './Panel.svelte';
  import Toast from './Toast.svelte';
  import type { OverlayActions } from './actions';
  import type { ShadowSelection } from './host';
  import type { OverlayState } from './state.svelte';

  interface Props {
    ui: OverlayState;
    actions: OverlayActions;
    getSelection: () => ShadowSelection | null;
    /** The shadow `.root` element; theme is applied there so tokens resolve. */
    root: HTMLElement;
  }

  let { ui, actions, getSelection, root }: Props = $props();

  $effect(() => {
    root.dataset.theme = ui.theme;
  });

  const pickFile = () => actions.pickFile();
</script>

{#if ui.panelVisible}
  {#if ui.compact}
    <CompactBar {ui} {actions} {getSelection} />
  {:else}
    <Panel {ui} {actions} {getSelection} onPickFile={pickFile} />
  {/if}
{/if}

{#if ui.launcherVisible || ui.menuOpen || (!ui.track && ui.panelVisible)}
  <Launcher {ui} {actions} onPickFile={pickFile} />
{/if}

{#if ui.dragOver}
  <div class="drop">
    <span>{ui.t('drop.hint')}</span>
  </div>
{/if}

{#if ui.mediaFormOpen}
  <MediaForm {ui} {actions} />
{/if}

{#if ui.searchOpen}
  <SearchDialog {ui} {actions} />
{/if}

{#if ui.card}
  <Card {ui} card={ui.card} {actions} {root} />
{/if}

<Toast {ui} {actions} />

<style>
  .drop {
    position: absolute;
    inset: 10px;
    display: flex;
    align-items: center;
    justify-content: center;
    border: 3px dashed var(--accent);
    border-radius: 18px;
    background: rgba(0, 0, 0, 0.45);
    color: #fff;
    font-size: 20px;
    font-weight: 700;
  }
</style>
