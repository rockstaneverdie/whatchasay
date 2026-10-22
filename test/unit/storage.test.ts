import 'fake-indexeddb/auto';
import { beforeEach, describe, expect, it } from 'vitest';
import { fakeBrowser } from 'wxt/testing/fake-browser';
import {
  cacheStats,
  getCached,
  importCache,
  markBad,
  pruneCache,
  putCached,
} from '../../src/core/storage/cache';
import { resetDbForTests } from '../../src/core/storage/idb';
import { getForMedia, getTrackMediaInfo, saveForMedia, updateEntry } from '../../src/core/storage/library';
import { addPhrase, listPhrases, phrasesToCsv } from '../../src/core/storage/phrases';
import { loadSecrets, saveSecrets } from '../../src/core/storage/secrets';
import { DEFAULT_SETTINGS, loadSettings, saveSettings } from '../../src/core/storage/settings';
import type { Track } from '../../src/core/subtitles/types';

beforeEach(async () => {
  // A fresh database per test.
  await resetDbForTests();
  await new Promise((resolve) => {
    const r = indexedDB.deleteDatabase('subtext');
    r.onsuccess = r.onerror = r.onblocked = resolve;
  });
  fakeBrowser.reset();
});

const track: Track = {
  id: 'abc',
  label: 'Maple.Street.S01E03.srt',
  source: 'file',
  offsetMs: 0,
  cues: [{ id: 1, start: 1, end: 2, text: 'Hi', lines: ['Hi'], kind: 'speech' }],
};

describe('settings', () => {
  it('merges stored values over defaults and clamps them', async () => {
    expect(await loadSettings()).toEqual(DEFAULT_SETTINGS);
    await saveSettings({ level: 'C1', panel: { widthPct: 90 } });
    const s = await loadSettings();
    expect(s.level).toBe('C1');
    expect(s.panel).toEqual({ ...DEFAULT_SETTINGS.panel, widthPct: 40 });
  });

  it('keeps keys in storage.local only', async () => {
    await saveSecrets({ geminiKey: 'AIza-test' });
    expect(await loadSecrets()).toEqual({ geminiKey: 'AIza-test' });
    expect(await fakeBrowser.storage.sync.get(null)).toEqual({});
    await saveSecrets({ geminiKey: '' });
    expect(await loadSecrets()).toEqual({});
  });
});

describe('library (FR-S5, FR-M3)', () => {
  it('restores the track with its offset and media info', async () => {
    await saveForMedia('mk', track, { title: 'Maple Street', season: 1, episode: 3 });
    await updateEntry('mk', { offsetMs: 300 });
    const got = await getForMedia('mk');
    expect(got?.track.offsetMs).toBe(300);
    expect(got?.entry.mediaInfo).toEqual({ title: 'Maple Street', season: 1, episode: 3 });
    expect(await getForMedia('other')).toBeNull();
  });

  it('remembers media info per track', async () => {
    await saveForMedia('page1', track, { title: 'Guess' });
    await updateEntry('page1', { mediaInfo: { title: 'Maple Street', season: 1 } });
    expect(await getTrackMediaInfo('abc')).toEqual({ title: 'Maple Street', season: 1 });
  });
});

describe('explanation cache (FR-K)', () => {
  const result = { text: 'x'.repeat(100), type: 'idiom' as const, confidence: 'high' as const };

  it('stores, hits and hides 👎 entries', async () => {
    await putCached('k1', result, 'm', 1e9);
    expect((await getCached('k1'))?.text).toBe(result.text);
    await markBad('k1');
    expect(await getCached('k1')).toBeNull();
  });

  it('evicts least recently used entries over the limit', async () => {
    for (const k of ['a', 'b', 'c']) {
      await putCached(k, result, 'm', 1e9);
      await new Promise((r) => setTimeout(r, 2));
    }
    await getCached('a'); // a becomes most recent
    const one = (await cacheStats()).bytes / 3;
    await pruneCache(one * 2 + 1);
    expect(await getCached('b')).toBeNull();
    expect(await getCached('a')).not.toBeNull();
    expect(await getCached('c')).not.toBeNull();
  });

  it('imports only well-formed records', async () => {
    expect(await importCache([{ key: 'z', text: 't' }, { nope: 1 }, null], 1e9)).toBe(1);
    await expect(importCache({}, 1e9)).rejects.toThrow();
  });
});

describe('phrases (FR-W1)', () => {
  it('lists newest first and exports Anki CSV', async () => {
    await addPhrase({
      phrase: 'square one',
      cueText: "So we're back to square one.",
      explanation: 'Начинаем "заново".',
      type: 'idiom',
      show: 'Maple Street S01E03',
      time: 14,
    });
    await new Promise((r) => setTimeout(r, 2));
    await addPhrase({
      phrase: 'Low bar.',
      cueText: 'Low bar.',
      explanation: 'Планка низкая.',
      type: 'slang',
      show: 'Maple Street S01E03',
      time: 58,
    });
    const items = await listPhrases();
    expect(items.map((p) => p.phrase)).toEqual(['Low bar.', 'square one']);
    const csv = phrasesToCsv(items);
    expect(csv.startsWith('\uFEFF"Front","Back","Show","Time","Type"\r\n')).toBe(true);
    expect(csv).toContain(
      '"So we\'re back to <b>square one</b>.","Начинаем ""заново"".","Maple Street S01E03","0:14","idiom"',
    );
    expect(csv).toContain('"Low bar.","Планка низкая."');
  });
});
