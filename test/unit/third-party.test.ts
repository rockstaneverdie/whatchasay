import { afterEach, describe, expect, it, vi } from 'vitest';
import { FrameRegistry } from '../../src/core/messaging/frames';
import { findVideos, hasClosedPlayer } from '../../src/core/player/find-video';
import { DEFAULT_HOTKEYS } from '../../src/core/player/hotkeys';
import { durationSuggestsNewMedia, routeKey, type KeyContext } from '../../src/core/player/key-router';
import { composedAncestors, composedContains } from '../../src/utils/dom';
import { pageTitle, pageUrl } from '../../src/utils/page';

const key = (
  code: string,
  mods: Partial<Record<'altKey' | 'ctrlKey' | 'shiftKey' | 'metaKey' | 'repeat', boolean>> = {},
) => ({
  code,
  altKey: false,
  ctrlKey: false,
  shiftKey: false,
  metaKey: false,
  ...mods,
});

const ctx = (over: Partial<KeyContext> = {}): KeyContext => ({
  hasVideo: true,
  hasTrack: true,
  cardOpen: false,
  dialogOpen: false,
  editable: false,
  hotkeys: { ...DEFAULT_HOTKEYS },
  ...over,
});

describe('routeKey (FR-I4, FR-V5, FR-V8)', () => {
  it('Space and Esc belong to an open card', () => {
    expect(routeKey(key('Space'), ctx({ cardOpen: true }))).toEqual({
      action: { kind: 'card-resume' },
      swallow: true,
    });
    expect(routeKey(key('Escape'), ctx({ cardOpen: true }))).toEqual({
      action: { kind: 'card-close' },
      swallow: true,
    });
    expect(routeKey(key('Space', { shiftKey: true }), ctx({ cardOpen: true }))).toBeNull();
  });

  it('leaves Space to the site when no card is open', () => {
    expect(routeKey(key('Space'), ctx())).toBeNull();
  });

  it('acts only with a track, except Alt+L', () => {
    const noTrack = ctx({ hasTrack: false });
    expect(routeKey(key('KeyE'), noTrack)).toBeNull();
    expect(routeKey(key('BracketRight'), noTrack)).toBeNull();
    expect(routeKey(key('KeyL', { altKey: true }), noTrack)?.action).toEqual({ kind: 'toggle-panel' });
  });

  it('maps offsets with Shift as the coarse step and swallows auto-repeat of one-shot keys', () => {
    expect(routeKey(key('BracketLeft'), ctx())?.action).toEqual({ kind: 'offset', deltaMs: -100 });
    expect(routeKey(key('BracketRight', { shiftKey: true }), ctx())?.action).toEqual({
      kind: 'offset',
      deltaMs: 1000,
    });
    expect(routeKey(key('KeyE', { repeat: true }), ctx())).toEqual({ action: null, swallow: true });
  });

  it('ignores typing and frames without a video', () => {
    expect(routeKey(key('KeyE'), ctx({ editable: true }))).toBeNull();
    expect(routeKey(key('Space'), ctx({ editable: true, cardOpen: true }))).toBeNull();
    expect(routeKey(key('KeyL', { altKey: true }), ctx({ hasVideo: false }))).toBeNull();
  });

  it('Esc closes our dialogs first', () => {
    expect(routeKey(key('Escape'), ctx({ dialogOpen: true }))?.action).toEqual({ kind: 'close-dialogs' });
  });
});

describe('durationSuggestsNewMedia (FR-V9)', () => {
  it('needs a settled duration, a real change and playback near the start', () => {
    expect(durationSuggestsNewMedia(1320, 1450, 0.2, 60_000)).toBe(true);
    expect(durationSuggestsNewMedia(1320, 1330, 0.2, 60_000)).toBe(false); // < 5 %
    expect(durationSuggestsNewMedia(1320, 1450, 300, 60_000)).toBe(false); // mid-playback
    expect(durationSuggestsNewMedia(120, 1450, 0, 2_000)).toBe(false); // still loading/growing
    expect(durationSuggestsNewMedia(NaN, 1450, 0, 60_000)).toBe(false);
    expect(durationSuggestsNewMedia(1320, Infinity, 0, 60_000)).toBe(false); // live
  });
});

describe('FrameRegistry (FR-V5)', () => {
  it('prefers an open card, then a track, then any video; forgets frames without video', () => {
    const r = new FrameRegistry();
    r.update(1, 0, { hasVideo: true, hasTrack: false, cardOpen: false });
    r.update(1, 7, { hasVideo: true, hasTrack: true, cardOpen: false });
    expect(r.best(1)?.frameId).toBe(7);
    r.update(1, 3, { hasVideo: true, hasTrack: true, cardOpen: true });
    expect(r.best(1)).toEqual({ frameId: 3, hasVideo: true, hasTrack: true, cardOpen: true });
    r.update(1, 3, { hasVideo: false, hasTrack: false, cardOpen: false });
    expect(r.best(1)?.frameId).toBe(7);
    expect(r.best(2)).toBeNull();
  });

  it('round-trips through storage.session', () => {
    const r = new FrameRegistry();
    r.update(4, 2, { hasVideo: true, hasTrack: true, cardOpen: false });
    const copy = new FrameRegistry();
    copy.restore(JSON.parse(JSON.stringify(r.dump())));
    copy.restore('garbage');
    expect(copy.best(4)?.frameId).toBe(2);
    copy.forget(4);
    expect(copy.best(4)).toBeNull();
  });

  it('drops state left over from a previous document', () => {
    const r = new FrameRegistry();
    const withTrack = { hasVideo: true, hasTrack: true, cardOpen: false };
    // The top page had the player; its pagehide report never arrived.
    r.update(1, 0, withTrack);
    r.update(1, 9, withTrack);
    // A frame reloads: only its own entry goes.
    expect(r.documentStarted(1, 9)).toBe(true);
    expect(r.best(1)?.frameId).toBe(0);
    expect(r.documentStarted(1, 9)).toBe(false);
    // The top frame starts a new document: the whole tab is new, so the new player frame wins.
    r.update(1, 9, withTrack);
    expect(r.documentStarted(1, 0)).toBe(true);
    expect(r.best(1)).toBeNull();
    r.update(1, 12, withTrack);
    expect(r.best(1)?.frameId).toBe(12);
  });
});

describe('shadow DOM players (FR-V6)', () => {
  it('finds videos in nested open shadow roots and reports the roots', () => {
    document.body.innerHTML = '<video id="plain"></video><div id="outer"></div>';
    const outer = document.getElementById('outer')!.attachShadow({ mode: 'open' });
    outer.innerHTML = '<div id="inner-host"></div><video id="in-outer"></video>';
    const inner = (outer.getElementById('inner-host') as HTMLElement).attachShadow({ mode: 'open' });
    inner.innerHTML = '<div><video id="deep"></video></div>';
    const roots: ShadowRoot[] = [];
    expect(findVideos(document, roots).map((v) => v.id)).toEqual(['plain', 'in-outer', 'deep']);
    expect(roots).toHaveLength(2);

    const deep = inner.querySelector('video')!;
    expect(composedContains(document.getElementById('outer')!, deep)).toBe(true);
    expect(composedAncestors(deep).map((e) => e.id || e.tagName)).toContain('outer');
  });

  it('notices a closed player only through openOrClosedShadowRoot', () => {
    document.body.innerHTML = '<locked-player></locked-player><plain-thing></plain-thing>';
    const locked = document.querySelector('locked-player')!;
    const closed = locked.attachShadow({ mode: 'closed' });
    closed.innerHTML = '<video></video>';
    expect(hasClosedPlayer(document)).toBe(false); // no Firefox API in the test DOM
    Object.defineProperty(locked, 'openOrClosedShadowRoot', { value: closed });
    expect(hasClosedPlayer(document)).toBe(true);
    expect(findVideos(document)).toHaveLength(0); // never mounted into
  });
});

describe('page identity of frames without a URL', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
    Reflect.deleteProperty(document, 'baseURI');
    document.title = '';
  });

  it('uses the location of an ordinary frame', () => {
    vi.stubGlobal('location', new URL('https://videos.example/watch/7?t=3'));
    document.title = 'Maple Street S01E03';
    expect(pageUrl().pathname).toBe('/watch/7');
    expect(pageTitle()).toBe('Maple Street S01E03');
  });

  it('uses the inherited base URL and the parent title in about:blank / about:srcdoc', () => {
    vi.stubGlobal('location', new URL('about:srcdoc'));
    Object.defineProperty(document, 'baseURI', {
      value: 'https://videos.example/watch/7',
      configurable: true,
    });
    vi.stubGlobal('parent', { document: { title: 'Maple Street S01E03' } });
    expect(pageUrl().origin + pageUrl().pathname).toBe('https://videos.example/watch/7');
    expect(pageTitle()).toBe('Maple Street S01E03');
  });
});
