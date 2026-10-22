<script lang="ts">
  import Line from './Line.svelte';
  import type { OverlayActions } from './actions';
  import type { ShadowSelection } from './host';
  import { describeClick } from './click-target';
  import type { OverlayState } from './state.svelte';

  interface Props {
    ui: OverlayState;
    actions: OverlayActions;
    getSelection: () => ShadowSelection | null;
    onPickFile: () => void;
  }

  let { ui, actions, getSelection, onPickFile }: Props = $props();

  /** FR-P3: the active line sits at ~35 % of the panel height. */
  const ANCHOR = 0.35;
  /** FR-P4: manual scrolling pauses autoscroll for 3 s of inactivity. */
  const IDLE_MS = 3000;

  let panelEl: HTMLDivElement | undefined = $state();
  let listEl: HTMLDivElement | undefined = $state();
  let panelH = $state(0);
  let y = $state(0);
  let animate = $state(true);
  let manual = $state(false);
  let idleTimer: ReturnType<typeof setTimeout> | undefined;

  const cues = $derived(ui.track?.cues ?? []);
  const activeSet = $derived(new Set(ui.active));

  function distanceOf(i: number): number {
    if (activeSet.has(i)) return 0;
    return ui.focus < 0 ? i + 1 : i - ui.focus;
  }

  function targetY(index: number): number {
    const el = listEl?.children[Math.max(0, index)] as HTMLElement | undefined;
    return panelH * ANCHOR - (el?.offsetTop ?? 0);
  }

  function clampY(v: number): number {
    const listH = listEl?.offsetHeight ?? 0;
    return Math.min(panelH * ANCHOR, Math.max(panelH * ANCHOR - listH, v));
  }

  function backToCurrent() {
    clearTimeout(idleTimer);
    manual = false;
    animate = true;
    y = targetY(ui.focus);
  }

  // Autoscroll: follows the focused cue (and font/size changes) unless the user scrolled.
  $effect(() => {
    const f = ui.focus;
    void panelH;
    void cues;
    void ui.settings.panel.fontScale;
    void ui.box.width;
    if (manual) return;
    animate = true;
    y = targetY(f);
  });

  // Wheel needs passive: false to keep the page from scrolling.
  $effect(() => {
    const el = panelEl;
    if (!el) return;
    const onWheel = (e: WheelEvent) => {
      if (cues.length === 0) return;
      e.preventDefault();
      const dy = e.deltaMode === 1 ? e.deltaY * 18 : e.deltaMode === 2 ? e.deltaY * panelH : e.deltaY;
      manual = true;
      animate = false;
      y = clampY(y - dy);
      clearTimeout(idleTimer);
      idleTimer = setTimeout(backToCurrent, IDLE_MS);
    };
    el.addEventListener('wheel', onWheel, { passive: false });
    return () => {
      el.removeEventListener('wheel', onWheel);
      clearTimeout(idleTimer);
    };
  });

  function onClick(e: MouseEvent) {
    const hit = describeClick(e.target as Element, getSelection());
    if (!hit) return;
    if (hit.kind === 'seek') {
      actions.seekToCue(hit.index);
      return;
    }
    const cue = cues[hit.index];
    if (!cue || cue.kind !== 'speech') return;
    actions.explain({
      cueIndex: hit.index,
      ...(hit.focusText ? { focusText: hit.focusText } : {}),
      ...(hit.anchorEl ? { anchorEl: hit.anchorEl } : {}),
      ...(hit.anchorRect ? { anchorRect: hit.anchorRect } : {}),
    });
  }

  // FR-P1: drag the inner edge to resize (28–40 % of the video width).
  function startResize(e: PointerEvent) {
    const handle = e.currentTarget as HTMLElement;
    handle.setPointerCapture(e.pointerId);
    const root = panelEl?.parentElement?.getBoundingClientRect();
    if (!root) return;
    const right = ui.settings.panel.side === 'right';
    let pct = ui.settings.panel.widthPct;
    const move = (ev: PointerEvent) => {
      const px = right ? root.right - ev.clientX : ev.clientX - root.left;
      pct = (px / root.width) * 100;
      actions.setPanelWidth(pct, false);
    };
    const up = () => {
      handle.removeEventListener('pointermove', move);
      handle.removeEventListener('pointerup', up);
      actions.setPanelWidth(pct, true);
    };
    handle.addEventListener('pointermove', move);
    handle.addEventListener('pointerup', up);
  }
</script>

<div
  bind:this={panelEl}
  bind:clientHeight={panelH}
  class="panel glass interactive"
  class:left={ui.settings.panel.side === 'left'}
  class:reduced={ui.reducedMotion}
  style:width="{ui.settings.panel.widthPct}%"
  style:--font-scale={ui.settings.panel.fontScale}
  aria-label={ui.t('panel.label')}
>
  {#if cues.length === 0}
    <div class="empty">
      <p>{ui.t('panel.empty')}</p>
      <button type="button" class="icon-btn" onclick={onPickFile}>{ui.t('panel.choose')}</button>
    </div>
  {:else}
    <!-- Keyboard users explain via the E hotkey; clicks here are a pointer shortcut. -->
    <!-- svelte-ignore a11y_click_events_have_key_events, a11y_no_noninteractive_element_interactions -->
    <div
      bind:this={listEl}
      class="list"
      class:animate
      role="list"
      style:transform="translate3d(0, {y}px, 0)"
      onclick={onClick}
    >
      {#each cues as cue, i (cue.id)}
        <Line {cue} index={i} distance={distanceOf(i)} active={activeSet.has(i)} {ui} />
      {/each}
    </div>
    {#if manual}
      <button type="button" class="to-current icon-btn" onclick={backToCurrent}
        >{ui.t('panel.toCurrent')}</button
      >
    {/if}
  {/if}
  <div
    class="resize"
    role="separator"
    aria-orientation="vertical"
    aria-label={ui.t('panel.resize')}
    onpointerdown={startResize}
  ></div>
</div>

<style>
  .panel {
    position: absolute;
    top: 0;
    /* Leave the site's control bar (play, seek, fullscreen) clickable. */
    bottom: clamp(44px, 11%, 84px);
    right: 0;
    overflow: hidden;
    padding: 0 1.1em 0 1.3em;
    font-size: calc(var(--size-active) * var(--font-scale, 1));
    -webkit-mask-image: linear-gradient(transparent 0, #000 9%, #000 88%, transparent 100%);
    mask-image: linear-gradient(transparent 0, #000 9%, #000 88%, transparent 100%);
  }

  .panel.left {
    right: auto;
    left: 0;
  }

  .list {
    will-change: transform;
  }

  .list.animate {
    transition: transform var(--dur) var(--ease);
  }

  .reduced .list.animate {
    transition: none;
  }

  /* 7.3: hovering the panel removes blur so selecting text is easy. */
  .panel:hover :global(.line) {
    filter: none;
  }

  .reduced :global(.line) {
    transition: opacity var(--dur) linear;
  }

  .empty {
    position: absolute;
    inset: 0;
    display: flex;
    flex-direction: column;
    align-items: center;
    justify-content: center;
    gap: 12px;
    padding: 24px;
    text-align: center;
    font-size: 15px;
    color: var(--text-muted);
  }

  .to-current {
    position: absolute;
    left: 50%;
    bottom: 14%;
    transform: translateX(-50%);
    background: var(--accent);
    color: #fff;
  }

  .resize {
    position: absolute;
    top: 0;
    bottom: 0;
    left: 0;
    width: 8px;
    cursor: ew-resize;
  }

  .left .resize {
    left: auto;
    right: 0;
  }
</style>
