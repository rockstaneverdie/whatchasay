<script lang="ts">
  import type { OverlayActions } from './actions';
  import type { OverlayState } from './state.svelte';

  interface Props {
    ui: OverlayState;
    actions: OverlayActions;
  }

  let { ui, actions }: Props = $props();
</script>

{#if ui.toast}
  {@const toast = ui.toast}
  <div class="toast glass interactive" role="status" aria-live="polite">
    <span>{toast.text}</span>
    {#if toast.action}
      <button
        type="button"
        class="icon-btn"
        onclick={() => {
          toast.action?.run();
          actions.dismissToast();
        }}>{toast.action.label}</button
      >
    {/if}
  </div>
{/if}

<style>
  .toast {
    position: absolute;
    left: 50%;
    top: 16px;
    transform: translateX(-50%);
    display: flex;
    align-items: center;
    gap: 10px;
    max-width: min(80%, 520px);
    padding: 8px 10px 8px 16px;
    border: 1px solid var(--hairline);
    border-radius: 999px;
    background: var(--bg-card);
    box-shadow: var(--shadow);
    font-size: 14px;
    font-weight: 550;
  }
</style>
