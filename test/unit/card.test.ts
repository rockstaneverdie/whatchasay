import { fireEvent, render } from '@testing-library/svelte';
import { flushSync } from 'svelte';
import { describe, expect, it, vi } from 'vitest';
import type { OverlayActions } from '../../src/ui/actions';
import Card from '../../src/ui/Card.svelte';
import { OverlayState, type CardState } from '../../src/ui/state.svelte';

function actions(): OverlayActions {
  return new Proxy({} as OverlayActions, {
    get: (t, k) => ((t as unknown as Record<string, unknown>)[k as string] ??= vi.fn()),
  });
}

function setup(card: Partial<CardState>) {
  const ui = new OverlayState();
  ui.card = {
    reqId: 1,
    target: { cueIndex: 0 },
    cueId: 1,
    mode: 'short',
    status: 'loading',
    text: '',
    cached: false,
    ...card,
  };
  const root = document.createElement('div');
  document.body.append(root);
  const a = actions();
  const r = render(Card, { props: { ui, card: ui.card!, actions: a, root }, target: root });
  return { ui, a, ...r };
}

describe('Card', () => {
  it('shows a skeleton, then streamed text, then type, confidence and actions', () => {
    const { ui, container } = setup({});
    expect(container.querySelector('.skeleton')).not.toBeNull();
    expect(container.querySelector('.actions')).toBeNull();

    ui.card!.status = 'streaming';
    ui.card!.text = 'Here **square one** means';
    flushSync();
    expect(container.querySelector('.skeleton')).toBeNull();
    expect(container.querySelector('.text strong')!.textContent).toBe('square one');
    expect(container.querySelector('.caret')).not.toBeNull();

    Object.assign(ui.card!, {
      status: 'done',
      type: 'idiom',
      confidence: 'low',
      text: 'Here **square one** means start.',
    });
    flushSync();
    expect(container.querySelector('.chip')!.textContent).toBe('Идиома');
    expect(container.querySelectorAll('.dots .on')).toHaveLength(1);
    expect(container.textContent).toContain('не уверен');
    expect(container.querySelector('.actions')).not.toBeNull();
    expect(container.querySelector('[aria-live="polite"]')).not.toBeNull();
  });

  it('renders model output as text, never as HTML', () => {
    const { container } = setup({ status: 'done', text: '<img src=x onerror=alert(1)> **<b>bold</b>**' });
    expect(container.querySelector('img')).toBeNull();
    expect(container.querySelector('.text b')).toBeNull();
    expect(container.querySelector('.text strong')!.textContent).toBe('<b>bold</b>');
  });

  it('offers settings for key problems and retry for others', async () => {
    const { container, a, ui } = setup({ status: 'error', error: { code: 'no-key', message: 'x' } });
    expect(container.textContent).toContain('Не задан API-ключ.');
    await fireEvent.click(container.querySelector('.btn.primary')!);
    expect(a.openSettings).toHaveBeenCalled();

    ui.card!.error = { code: 'network', message: 'x' };
    flushSync();
    expect(container.textContent).toContain('Нет связи');
    await fireEvent.click(container.querySelector('.btn.primary')!);
    expect(a.retryCard).toHaveBeenCalled();
  });

  it('counts down a rate limit and disables retry meanwhile', () => {
    const { container, ui } = setup({
      status: 'error',
      error: { code: 'rate-limit', message: 'x', retryAfter: 30 },
      retryInSec: 30,
    });
    expect(container.textContent).toContain('через 30 с');
    expect(container.querySelector<HTMLButtonElement>('.btn.primary')!.disabled).toBe(true);
    ui.card!.retryInSec = 0;
    flushSync();
    expect(container.querySelector<HTMLButtonElement>('.btn.primary')!.disabled).toBe(false);
  });

  it('wires the action buttons', async () => {
    const { container, a } = setup({ status: 'done', text: 'x', type: 'slang', confidence: 'high' });
    await fireEvent.click(
      container.querySelector('[aria-label="Подробнее"]') ?? container.querySelector('.actions .btn')!,
    );
    expect(a.explainMore).toHaveBeenCalled();
    await fireEvent.click(container.querySelector('[aria-label="Сохранить"]')!);
    expect(a.saveCard).toHaveBeenCalled();
    await fireEvent.click(container.querySelector('[aria-label="Неудачно"]')!);
    expect(a.rateCard).toHaveBeenCalledWith('down');
    await fireEvent.click(container.querySelector('[aria-label="Закрыть"]')!);
    expect(a.closeCard).toHaveBeenCalledWith(false);
  });
});
