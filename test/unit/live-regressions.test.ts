import { describe, expect, it, vi } from 'vitest';
import { fakeBrowser } from 'wxt/testing/fake-browser';
import { sendBg } from '../../src/core/messaging/types';
import { listPageTracks, trackTitle } from '../../src/core/player/page-tracks';
import { reactive } from '../reactive.svelte';

/** Bugs first seen on a real site (Wikimedia Commons, video.js); see docs/decisions.md D-016. */

describe('page track labels', () => {
  it('drops bidi controls and does not repeat the language', () => {
    const video = {
      textTracks: [
        { kind: 'subtitles', label: 'English ‪(en)‬', language: 'en' },
        { kind: 'subtitles', label: 'العربية ‪(ar)‬', language: 'ar' },
        { kind: 'captions', label: '', language: 'de' },
        { kind: 'metadata', label: 'chapters', language: '' },
      ],
    } as unknown as HTMLVideoElement;
    const tracks = listPageTracks(video);
    expect(tracks.map(trackTitle)).toEqual(['English (en)', 'العربية (ar)', 'de']);
    expect(trackTitle({ label: 'English', lang: 'en' })).toBe('English (en)');
  });
});

describe('sendBg', () => {
  it('sends Svelte state proxies as plain data (structured clone would throw)', async () => {
    const spy = vi.spyOn(fakeBrowser.runtime, 'sendMessage').mockImplementation((async (msg: unknown) => {
      structuredClone(msg); // what the real messaging does
      return { ok: true, value: null };
    }) as never);
    const mediaInfo = reactive({ title: 'Sintel', year: 2010 });
    await expect(sendBg({ type: 'library/update', mediaKey: 'k', mediaInfo })).resolves.toBeNull();
    expect(spy.mock.calls[0]![0]).toEqual({
      type: 'library/update',
      mediaKey: 'k',
      mediaInfo: { title: 'Sintel', year: 2010 },
    });
  });
});
