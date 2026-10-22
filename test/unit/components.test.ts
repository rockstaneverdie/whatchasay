import { fireEvent, render } from '@testing-library/svelte';
import { flushSync } from 'svelte';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { Cue, Track } from '../../src/core/subtitles/types';
import type { OverlayActions } from '../../src/ui/actions';
import Line from '../../src/ui/Line.svelte';
import Panel from '../../src/ui/Panel.svelte';
import { OverlayState } from '../../src/ui/state.svelte';

const cue = (id: number, start: number, end: number, text: string, kind: Cue['kind'] = 'speech'): Cue => ({
  id,
  start,
  end,
  text,
  lines: [text],
  kind,
});

function actionsMock(): OverlayActions {
  const fn = () => vi.fn();
  return {
    pickFile: fn(),
    loadFile: fn(),
    setEncoding: fn(),
    seekToCue: fn(),
    togglePanel: fn(),
    setCompact: fn(),
    setPanelWidth: fn(),
    saveMediaInfo: fn(),
    selectVideo: fn(),
    importPageTrack: fn(),
    nudgeOffset: fn(),
    openSettings: fn(),
    dismissToast: fn(),
    openSearch: fn(),
    osSearch: fn(),
    osLoad: fn(),
    refreshSniffed: fn(),
    importSniffed: fn(),
    explain: fn(),
    closeCard: fn(),
    explainMore: fn(),
    refreshCard: fn(),
    repeatCue: fn(),
    saveCard: fn(),
    copyCard: fn(),
    rateCard: fn(),
    retryCard: fn(),
  };
}

afterEach(() => vi.useRealTimers());

describe('Line', () => {
  it('fills words of the active line by the clock', () => {
    const ui = new OverlayState();
    ui.time = 1.5;
    const { container } = render(Line, {
      props: { cue: cue(1, 1, 2.12, 'one two'), index: 0, distance: 0, active: true, ui },
    });
    const line = container.querySelector('.line')!;
    expect(line.classList.contains('active')).toBe(true);
    expect(line.classList.contains('karaoke')).toBe(true);
    const ps = [...container.querySelectorAll<HTMLElement>('.w')].map((w) =>
      Number(w.style.getPropertyValue('--p')),
    );
    expect(ps[0]).toBe(1);
    expect(ps[1]).toBe(0);

    ui.time = 1.75;
    flushSync();
    const p1 = Number(container.querySelectorAll<HTMLElement>('.w')[1]!.style.getPropertyValue('--p'));
    expect(p1).toBeGreaterThan(0);
    expect(p1).toBeLessThan(1);
  });

  it('dims neighbours and leaves sounds without karaoke', () => {
    const ui = new OverlayState();
    const { container } = render(Line, {
      props: { cue: cue(2, 3, 4, '[door slams]', 'sound'), index: 1, distance: 2, active: false, ui },
    });
    const line = container.querySelector<HTMLElement>('.line')!;
    expect(line.classList.contains('aux')).toBe(true);
    expect(line.classList.contains('karaoke')).toBe(false);
    expect(line.style.getPropertyValue('--o')).toBe('0.350');
    expect(line.getAttribute('style')).toContain('blur(1.20px)');
  });

  it('keeps real spaces between word spans so selections copy as text', () => {
    const ui = new OverlayState();
    const { container } = render(Line, {
      props: { cue: cue(1, 0, 1, 'Define "work".'), index: 0, distance: 1, active: false, ui },
    });
    expect(container.querySelector('.row')!.textContent!.replace(/\s+/g, ' ').trim()).toBe('Define "work".');
  });
});

describe('Panel', () => {
  function setup() {
    const ui = new OverlayState();
    const track: Track = {
      id: 't',
      label: 'x',
      source: 'file',
      offsetMs: 0,
      cues: [cue(1, 0, 1, 'Hello there.'), cue(2, 1, 2, 'Nice hat.'), cue(3, 2, 3, '[laughs]', 'sound')],
    };
    ui.track = track;
    ui.panelVisible = true;
    const actions = actionsMock();
    const result = render(Panel, { props: { ui, actions, getSelection: () => null, onPickFile: vi.fn() } });
    return { ui, actions, ...result };
  }

  it('shows an empty state without a track', () => {
    const ui = new OverlayState();
    const onPickFile = vi.fn();
    const { getByText } = render(Panel, {
      props: { ui, actions: actionsMock(), getSelection: () => null, onPickFile },
    });
    getByText('Выбрать файл').click();
    expect(onPickFile).toHaveBeenCalled();
  });

  it('marks the active line and dims the others by distance', () => {
    const { ui, container } = setup();
    ui.focus = 1;
    ui.active = [1];
    flushSync();
    const lines = [...container.querySelectorAll<HTMLElement>('.line')];
    expect(lines.map((l) => l.classList.contains('active'))).toEqual([false, true, false]);
    expect(lines[0]!.style.getPropertyValue('--o')).toBe('0.500');
  });

  it('explains a clicked word, the whole line, but not a sound cue', async () => {
    const { actions, container } = setup();
    const word = container.querySelectorAll<HTMLElement>('.line')[1]!.querySelector('.w')!;
    await fireEvent.click(word);
    expect(actions.explain).toHaveBeenLastCalledWith(
      expect.objectContaining({ cueIndex: 1, focusText: 'Nice' }),
    );

    await fireEvent.click(container.querySelectorAll<HTMLElement>('.line')[0]!);
    expect(actions.explain).toHaveBeenLastCalledWith(
      expect.not.objectContaining({ focusText: expect.anything() }),
    );

    vi.mocked(actions.explain).mockClear();
    await fireEvent.click(container.querySelectorAll<HTMLElement>('.line')[2]!);
    expect(actions.explain).not.toHaveBeenCalled();
  });

  it('seeks from the timestamp chip', async () => {
    const { actions, container } = setup();
    await fireEvent.click(container.querySelectorAll<HTMLElement>('.ts')[2]!);
    expect(actions.seekToCue).toHaveBeenCalledWith(2);
    expect(actions.explain).not.toHaveBeenCalled();
  });

  it('pauses autoscroll on wheel and returns after 3 s', async () => {
    vi.useFakeTimers();
    const { container } = setup();
    const panel = container.querySelector('.panel')!;
    panel.dispatchEvent(new WheelEvent('wheel', { deltaY: 100, bubbles: true, cancelable: true }));
    flushSync();
    expect(container.querySelector('.to-current')).not.toBeNull();
    vi.advanceTimersByTime(2900);
    flushSync();
    expect(container.querySelector('.to-current')).not.toBeNull();
    vi.advanceTimersByTime(200);
    flushSync();
    expect(container.querySelector('.to-current')).toBeNull();
  });
});
