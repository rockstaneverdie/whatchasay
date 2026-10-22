<script lang="ts">
  import Line from './Line.svelte';
  import type { OverlayActions } from './actions';
  import { describeClick } from './click-target';
  import type { ShadowSelection } from './host';
  import type { OverlayState } from './state.svelte';

  interface Props {
    ui: OverlayState;
    actions: OverlayActions;
    getSelection: () => ShadowSelection | null;
  }

  let { ui, actions, getSelection }: Props = $props();

  const cues = $derived(ui.track?.cues ?? []);

  function onClick(e: MouseEvent) {
    const hit = describeClick(e.target as Element, getSelection());
    if (!hit) return;
    if (hit.kind === 'seek') return actions.seekToCue(hit.index);
    if (cues[hit.index]?.kind !== 'speech') return;
    actions.explain({
      cueIndex: hit.index,
      ...(hit.focusText ? { focusText: hit.focusText } : {}),
      ...(hit.anchorEl ? { anchorEl: hit.anchorEl } : {}),
      ...(hit.anchorRect ? { anchorRect: hit.anchorRect } : {}),
    });
  }
</script>

<!-- FR-P8: one active line above the bottom of the video. -->
{#if ui.active.length > 0}
  <!-- Keyboard users explain via the E hotkey; clicks here are a pointer shortcut. -->
  <!-- svelte-ignore a11y_click_events_have_key_events, a11y_no_noninteractive_element_interactions -->
  <div
    class="bar glass interactive"
    role="list"
    aria-label={ui.t('panel.label')}
    style:--font-scale={ui.settings.panel.fontScale}
    onclick={onClick}
  >
    {#each ui.active as i (cues[i]?.id)}
      {#if cues[i]}
        <Line cue={cues[i]} index={i} distance={0} active={true} {ui} />
      {/if}
    {/each}
  </div>
{/if}

<style>
  .bar {
    position: absolute;
    left: 50%;
    bottom: 12%;
    transform: translateX(-50%);
    max-width: 92%;
    padding: 0.35em 0.7em 0;
    border-radius: 14px;
    font-size: calc(clamp(18px, 3.4cqw, 28px) * var(--font-scale, 1));
    text-align: center;
  }

  .bar :global(.line) {
    margin-bottom: 0.35em;
    transform-origin: center;
  }
</style>
