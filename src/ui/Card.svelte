<script lang="ts">
  import { autoUpdate, computePosition, flip, offset, shift, type VirtualElement } from '@floating-ui/dom';
  import { splitBold } from '../core/ai/response-parser';
  import { formatHotkey } from '../core/player/hotkeys';
  import type { MessageKey } from '../i18n';
  import type { OverlayActions } from './actions';
  import type { CardState, OverlayState } from './state.svelte';

  interface Props {
    ui: OverlayState;
    card: CardState;
    actions: OverlayActions;
    /** The overlay root: positioning boundary and fallback anchor. */
    root: HTMLElement;
  }

  let { ui, card, actions, root }: Props = $props();

  let el: HTMLDivElement | undefined = $state();

  const segments = $derived(splitBold(card.text.trim()));
  const busy = $derived(card.status === 'loading' || card.status === 'streaming');
  const confLevel = $derived(card.confidence === 'high' ? 3 : card.confidence === 'medium' ? 2 : 1);

  function reference(): Element | VirtualElement {
    const t = card.target;
    if (t.anchorEl?.isConnected) return t.anchorEl;
    if (t.anchorRect) {
      const r = t.anchorRect;
      return { getBoundingClientRect: () => r };
    }
    // Panel hidden: point at the top centre of the video.
    return {
      getBoundingClientRect: () => {
        const r = root.getBoundingClientRect();
        return new DOMRect(r.left + r.width / 2, r.top + r.height * 0.6, 0, 0);
      },
    };
  }

  // FR-I3: above the phrase, flipping/shifting when there is no room. Stays inside the video box.
  $effect(() => {
    const floating = el;
    if (!floating) return;
    void card.target;
    const ref = reference();
    const update = () =>
      computePosition(ref, floating, {
        placement: 'top',
        strategy: 'absolute',
        middleware: [offset(10), flip({ boundary: root, padding: 8 }), shift({ boundary: root, padding: 8 })],
      }).then(({ x, y }) => {
        floating.style.left = `${x}px`;
        floating.style.top = `${y}px`;
      });
    return autoUpdate(ref, floating, update, { animationFrame: false });
  });

  function errorText(): string {
    const e = card.error;
    if (!e) return '';
    if (e.code === 'rate-limit') {
      return card.retryInSec
        ? ui.t('error.rate-limit', { s: card.retryInSec })
        : ui.t('error.rate-limit.now');
    }
    const key = `error.${e.code}` as MessageKey;
    const known = ui.t(key);
    return known === key ? ui.t('error.unknown') : known;
  }
</script>

<div
  bind:this={el}
  class="card interactive"
  data-status={card.status}
  data-cached={card.cached}
  role="dialog"
  aria-modal="false"
  aria-label={card.type ? ui.t(`type.${card.type}`) : ui.t('card.loading')}
>
  <div class="head">
    {#if card.type}
      <span class="chip">{ui.t(`type.${card.type}`)}</span>
    {:else if busy}
      <span class="chip ghost">{ui.t('card.loading')}</span>
    {/if}
    {#if card.cached}<span class="badge">{ui.t('card.cached')}</span>{/if}
    <span class="spacer"></span>
    {#if card.confidence}
      <span
        class="dots"
        title={ui.t(`confidence.${card.confidence}`)}
        aria-label={ui.t(`confidence.${card.confidence}`)}
      >
        {#each [1, 2, 3] as i (i)}<span class:on={i <= confLevel}></span>{/each}
      </span>
      {#if card.confidence === 'low'}<span class="unsure">{ui.t('card.lowConfidence')}</span>{/if}
    {/if}
    <button type="button" class="x" aria-label={ui.t('card.close')} onclick={() => actions.closeCard(false)}
      >×</button
    >
  </div>

  <div class="body" aria-live="polite" aria-busy={busy}>
    {#if card.status === 'error'}
      <p class="error">{errorText()}</p>
      <div class="row">
        {#if card.error?.code === 'no-key' || card.error?.code === 'bad-key' || card.error?.code === 'no-permission'}
          <button type="button" class="btn primary" onclick={actions.openSettings}
            >{ui.t('error.openSettings')}</button
          >
        {:else}
          <button
            type="button"
            class="btn primary"
            disabled={!!card.retryInSec && card.retryInSec > 0}
            onclick={actions.retryCard}>{ui.t('error.retry')}</button
          >
        {/if}
      </div>
    {:else if card.status === 'loading' && !card.text}
      {#if card.retryInSec}
        <p class="muted">{ui.t('card.retrying', { s: card.retryInSec })}</p>
      {/if}
      <div class="skeleton" aria-hidden="true"><span></span><span></span><span class="short"></span></div>
    {:else}
      <p class="text">
        {#each segments as seg, i (i)}{#if seg.bold}<strong>{seg.text}</strong
            >{:else}{seg.text}{/if}{/each}{#if busy}<span class="caret"></span>{/if}
      </p>
    {/if}
  </div>

  {#if card.status === 'done'}
    <div class="actions">
      {#if card.mode === 'short'}
        <button type="button" class="btn" onclick={actions.explainMore}>{ui.t('card.more')}</button>
      {/if}
      <button
        type="button"
        class="btn icon"
        title="{ui.t('card.repeat')} ({formatHotkey(ui.settings.hotkeys.repeat)})"
        aria-label={ui.t('card.repeat')}
        onclick={() => {
          const i = ui.track?.cues.findIndex((c) => c.id === card.cueId) ?? -1;
          actions.repeatCue(i);
        }}>↻</button
      >
      <button
        type="button"
        class="btn icon"
        class:active={card.saved}
        title={ui.t('card.save')}
        aria-label={ui.t('card.save')}
        aria-pressed={!!card.saved}
        onclick={actions.saveCard}>★</button
      >
      <button
        type="button"
        class="btn icon"
        title={ui.t('card.copy')}
        aria-label={ui.t('card.copy')}
        onclick={actions.copyCard}>⧉</button
      >
      <span class="spacer"></span>
      <button
        type="button"
        class="btn icon"
        class:active={card.feedback === 'up'}
        aria-pressed={card.feedback === 'up'}
        title={ui.t('card.like')}
        aria-label={ui.t('card.like')}
        onclick={() => actions.rateCard('up')}>👍</button
      >
      <button
        type="button"
        class="btn icon"
        class:active={card.feedback === 'down'}
        aria-pressed={card.feedback === 'down'}
        title={ui.t('card.dislike')}
        aria-label={ui.t('card.dislike')}
        onclick={() => actions.rateCard('down')}>👎</button
      >
      <button
        type="button"
        class="btn icon"
        title={ui.t('card.refresh')}
        aria-label={ui.t('card.refresh')}
        onclick={actions.refreshCard}>⟳</button
      >
    </div>
  {/if}
  <div class="hint">{ui.t('card.hint')}</div>
</div>

<style>
  .card {
    position: absolute;
    left: 0;
    top: 0;
    width: min(360px, calc(100cqw - 24px));
    padding: 12px 14px 10px;
    border-radius: 16px;
    border: 1px solid var(--hairline);
    background: var(--bg-card);
    -webkit-backdrop-filter: blur(var(--blur)) saturate(1.4);
    backdrop-filter: blur(var(--blur)) saturate(1.4);
    box-shadow: var(--shadow);
    font-size: 15px;
    line-height: 1.4;
    z-index: 10;
  }

  .head {
    display: flex;
    align-items: center;
    gap: 8px;
    margin-bottom: 6px;
    min-height: 24px;
  }

  .chip {
    padding: 2px 9px;
    border-radius: 999px;
    background: var(--accent);
    color: #fff;
    font-size: 12px;
    font-weight: 700;
  }

  .chip.ghost {
    background: var(--chip-bg);
    color: var(--text-muted);
  }

  .badge {
    font-size: 11px;
    color: var(--text-muted);
  }

  .spacer {
    flex: 1;
  }

  .dots {
    display: inline-flex;
    gap: 3px;
  }

  .dots span {
    width: 7px;
    height: 7px;
    border-radius: 50%;
    border: 1px solid var(--text-muted);
  }

  .dots span.on {
    background: var(--text);
    border-color: var(--text);
  }

  .unsure {
    font-size: 12px;
    color: var(--accent);
    font-weight: 600;
  }

  .x {
    border: 0;
    background: transparent;
    font-size: 20px;
    line-height: 1;
    cursor: pointer;
    color: var(--text-muted);
    padding: 0 2px;
  }

  .text {
    margin: 0;
    white-space: pre-wrap;
  }

  .text strong {
    font-weight: 750;
  }

  .caret {
    display: inline-block;
    width: 0.5em;
    height: 1em;
    margin-left: 2px;
    vertical-align: -0.12em;
    background: var(--text-muted);
    animation: blink 1s steps(2) infinite;
  }

  @keyframes blink {
    50% {
      opacity: 0;
    }
  }

  .skeleton {
    display: flex;
    flex-direction: column;
    gap: 7px;
    padding: 4px 0;
  }

  .skeleton span {
    height: 11px;
    border-radius: 6px;
    background: linear-gradient(90deg, var(--chip-bg), var(--hairline), var(--chip-bg));
    background-size: 200% 100%;
    animation: shimmer 1.2s linear infinite;
  }

  .skeleton .short {
    width: 60%;
  }

  @keyframes shimmer {
    to {
      background-position: -200% 0;
    }
  }

  @media (prefers-reduced-motion: reduce) {
    .skeleton span,
    .caret {
      animation: none;
    }
  }

  .error {
    margin: 0 0 8px;
  }

  .muted {
    margin: 0 0 6px;
    color: var(--text-muted);
    font-size: 13px;
  }

  .row,
  .actions {
    display: flex;
    align-items: center;
    gap: 6px;
  }

  .actions {
    margin-top: 10px;
  }

  .btn {
    min-height: 28px;
    padding: 3px 10px;
    border: 0;
    border-radius: 999px;
    background: var(--chip-bg);
    font-size: 13px;
    font-weight: 600;
    cursor: pointer;
  }

  .btn:hover:not(:disabled) {
    background: var(--hairline);
  }

  .btn:disabled {
    opacity: 0.5;
    cursor: default;
  }

  .btn.icon {
    width: 30px;
    padding: 0;
  }

  .btn.primary {
    background: var(--accent);
    color: #fff;
  }

  .btn.active {
    background: var(--accent);
    color: #fff;
  }

  .hint {
    margin-top: 8px;
    font-size: 11px;
    color: var(--text-muted);
  }
</style>
