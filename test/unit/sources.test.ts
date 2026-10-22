import { describe, expect, it, vi } from 'vitest';
import {
  featureToMedia,
  mapResults,
  OpenSubtitlesClient,
  OS_USER_AGENT,
  searchQuery,
} from '../../src/core/sources/opensubtitles';
import { osOrigins } from '../../src/core/sources/service';
import {
  classifySubtitle,
  groupKeyOf,
  langHint,
  segmentIndex,
  SniffStore,
} from '../../src/core/sources/sniff';

const json = (status: number, body: unknown) =>
  new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });

const SEARCH_BODY = {
  data: [
    {
      attributes: {
        language: 'en',
        release: 'Harbour.Lights.S01E02.WEB',
        download_count: 1234,
        hearing_impaired: false,
        fps: 23.976,
        files: [{ file_id: 42, file_name: 'Harbour.Lights.S01E02.WEB.srt' }],
        feature_details: {
          feature_type: 'Episode',
          title: 'The Ferry',
          parent_title: 'Harbour Lights',
          year: 2021,
          season_number: 1,
          episode_number: 2,
        },
      },
    },
    { attributes: { language: 'en', files: [] } },
  ],
};

describe('OpenSubtitles mapping', () => {
  it('builds sorted lower-case queries', () => {
    expect(searchQuery({ query: 'Harbour Lights', season: 1, episode: 2, languages: 'EN, pt-BR' })).toBe(
      'episode_number=2&languages=en%2Cpt-br&order_by=download_count&query=harbour%20lights&season_number=1&type=episode',
    );
    expect(searchQuery({ query: 'Quiet Film', year: 2021, languages: 'en' })).toBe(
      'languages=en&order_by=download_count&query=quiet%20film&year=2021',
    );
  });

  it('maps results and feature details to media info (M4 auto-fill)', () => {
    expect(mapResults(SEARCH_BODY)).toEqual([
      {
        fileId: 42,
        fileName: 'Harbour.Lights.S01E02.WEB.srt',
        release: 'Harbour.Lights.S01E02.WEB',
        language: 'en',
        downloads: 1234,
        hearingImpaired: false,
        machineTranslated: false,
        fps: 23.976,
        media: { title: 'Harbour Lights', season: 1, episode: 2, year: 2021 },
      },
    ]);
    expect(featureToMedia({ feature_type: 'Movie', title: 'Quiet Film', year: 2019 })).toEqual({
      title: 'Quiet Film',
      year: 2019,
    });
  });
});

describe('OpenSubtitlesClient', () => {
  const base = 'https://api.opensubtitles.com/api/v1';

  it('sends the key, user agent and token as headers', async () => {
    const fetch = vi.fn().mockResolvedValue(json(200, SEARCH_BODY));
    const c = new OpenSubtitlesClient({ apiKey: 'K', token: 'T', baseUrl: base }, fetch);
    await c.search({ query: 'x', languages: 'en' });
    const [url, init] = fetch.mock.calls[0]!;
    expect(url).toBe(`${base}/subtitles?languages=en&order_by=download_count&query=x`);
    expect(init.headers).toMatchObject({
      'Api-Key': 'K',
      'User-Agent': OS_USER_AGENT,
      Authorization: 'Bearer T',
    });
  });

  it('downloads in two steps and decodes the file', async () => {
    const srt = '1\n00:00:01,000 --> 00:00:02,000\nCafé\n';
    const fetch = vi
      .fn()
      .mockResolvedValueOnce(
        json(200, { link: 'https://dl.opensubtitles.com/x/42.srt', file_name: 'a.srt', remaining: 4 }),
      )
      .mockResolvedValueOnce(new Response(new TextEncoder().encode(srt)));
    const c = new OpenSubtitlesClient({ apiKey: 'K', baseUrl: base }, fetch);
    expect(await c.download(42)).toEqual({ name: 'a.srt', text: srt, remaining: 4 });
    expect(JSON.parse(fetch.mock.calls[0]![1].body)).toEqual({ file_id: 42, sub_format: 'srt' });
    expect(fetch.mock.calls[1]![1].headers).toBeUndefined();
  });

  it('maps quota, key and network errors', async () => {
    const cases: [Response | Error, string][] = [
      [json(406, { message: 'You have downloaded your allowed 5 subtitles' }), 'rate-limit'],
      [json(401, { message: 'Invalid API key' }), 'bad-key'],
      [json(429, {}), 'rate-limit'],
      [new TypeError('NetworkError'), 'network'],
    ];
    for (const [r, code] of cases) {
      const fetch = r instanceof Error ? vi.fn().mockRejectedValue(r) : vi.fn().mockResolvedValue(r);
      const c = new OpenSubtitlesClient({ apiKey: 'K', baseUrl: base }, fetch);
      await expect(c.download(1)).rejects.toMatchObject({ code });
    }
    await expect(
      new OpenSubtitlesClient({ apiKey: '', baseUrl: base }, vi.fn()).search({ languages: 'en' }),
    ).rejects.toMatchObject({
      code: 'no-key',
    });
  });

  it('logs in and picks up a VIP host', async () => {
    const fetch = vi
      .fn()
      .mockResolvedValue(
        json(200, { token: 'JWT', base_url: 'vip-api.opensubtitles.com', user: { allowed_downloads: 1000 } }),
      );
    const c = new OpenSubtitlesClient({ apiKey: 'K', baseUrl: base }, fetch);
    expect(await c.login('u', 'p')).toEqual({
      token: 'JWT',
      baseUrl: 'https://vip-api.opensubtitles.com/api/v1',
      allowedDownloads: 1000,
    });
  });

  it('needs the API host and the download host', () => {
    expect(osOrigins(base)).toEqual(['https://api.opensubtitles.com/*', 'https://*.opensubtitles.com/*']);
    expect(osOrigins('http://localhost:5557/api/v1')).toEqual(['http://localhost/*']);
  });
});

describe('subtitle sniffing (FR-S8)', () => {
  it('classifies by content type, then by extension; never media or playlists', () => {
    expect(classifySubtitle('https://cdn.example/a', 'text/vtt; charset=utf-8')).toBe('vtt');
    expect(classifySubtitle('https://cdn.example/a', 'application/ttml+xml')).toBe('ttml');
    expect(classifySubtitle('https://cdn.example/subs/en.srt?sig=1', 'application/octet-stream')).toBe('srt');
    expect(classifySubtitle('https://cdn.example/x.vtt', undefined)).toBe('vtt');
    expect(classifySubtitle('https://cdn.example/x.dfxp', 'text/plain')).toBe('ttml');
    expect(classifySubtitle('https://cdn.example/video.mp4', 'video/mp4')).toBeNull();
    expect(classifySubtitle('https://cdn.example/master.m3u8', 'application/vnd.apple.mpegurl')).toBeNull();
    expect(classifySubtitle('https://cdn.example/sub.vtt', 'text/html')).toBeNull();
    expect(classifySubtitle('https://cdn.example/data.json', 'application/json')).toBeNull();
    expect(classifySubtitle('not a url', undefined)).toBeNull();
  });

  it('groups segments and orders them by number', () => {
    expect(groupKeyOf('https://cdn.example/s/en/seg-12.vtt?t=1')).toBe('https://cdn.example/s/en/seg-#.vtt');
    expect(groupKeyOf('https://cdn.example/s/fileSequence3.webvtt')).toBe(
      'https://cdn.example/s/fileSequence#.webvtt',
    );
    expect(segmentIndex('https://cdn.example/s/seg-12.vtt')).toBe(12);
    const store = new SniffStore();
    store.add(1, 'https://cdn.example/s/en/seg-2.vtt', 'text/vtt', 10);
    store.add(1, 'https://cdn.example/s/en/seg-1.vtt', 'text/vtt', 11);
    store.add(1, 'https://cdn.example/s/en/seg-1.vtt', 'text/vtt', 12);
    store.add(1, 'https://cdn.example/movie.mp4', 'video/mp4', 13);
    store.add(2, 'https://other.example/sub.srt', undefined, 14);
    expect(store.list(1)).toEqual([
      { key: 'https://cdn.example/s/en/seg-#.vtt', label: 'seg-*.vtt', format: 'vtt', lang: 'en', parts: 2 },
    ]);
    expect(store.urls(1, 'https://cdn.example/s/en/seg-#.vtt')).toEqual([
      'https://cdn.example/s/en/seg-1.vtt',
      'https://cdn.example/s/en/seg-2.vtt',
    ]);
    store.clear(1);
    expect(store.list(1)).toEqual([]);
    expect(store.list(2)).toHaveLength(1);
  });

  it('guesses the language from the URL', () => {
    expect(langHint('https://x.example/subs/eng/1.vtt')).toBe('eng');
    expect(langHint('https://x.example/track_ru.vtt')).toBe('ru');
    expect(langHint('https://x.example/sub.vtt?lang=de')).toBe('de');
    expect(langHint('https://x.example/subtitles/1.vtt')).toBeUndefined();
  });
});
