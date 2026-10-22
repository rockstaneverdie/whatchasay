// A small stand-in for the OpenSubtitles REST API v1, for E2E tests.
//   GET  /api/v1/subtitles   – two invented results for any query
//   POST /api/v1/download    – a link to /files/<id>.srt
//   POST /api/v1/login       – a token
//   GET  /files/42.srt       – test/fixtures/sample.srt shifted by +2.3 s (autosync check)
//   GET  /stats              – last request headers and counters
// The key "e2e-bad" gets 401, any key with "quota" gets 406 on download.
import { readFileSync } from 'node:fs';
import { createServer } from 'node:http';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..', 'test', 'fixtures');

export const SHIFT = 2.3;

function shiftSrt(text, by) {
  const ts = (s) => {
    const [h, m, rest] = s.split(':');
    const [sec, ms] = rest.split(',');
    return Number(h) * 3600 + Number(m) * 60 + Number(sec) + Number(ms) / 1000;
  };
  const fmt = (t) => {
    const ms = Math.round(t * 1000);
    const p = (n, w = 2) => String(n).padStart(w, '0');
    return `${p(Math.floor(ms / 3600000))}:${p(Math.floor(ms / 60000) % 60)}:${p(Math.floor(ms / 1000) % 60)},${p(ms % 1000, 3)}`;
  };
  return text.replace(
    /(\d+:\d+:\d+,\d+)\s*-->\s*(\d+:\d+:\d+,\d+)/g,
    (_, a, b) => `${fmt(ts(a) + by)} --> ${fmt(ts(b) + by)}`,
  );
}

export function startMockOs(port = 5557) {
  const stats = { searches: 0, downloads: 0, lastHeaders: null, lastQuery: null };
  const send = (res, status, body) => {
    res.writeHead(status, { 'content-type': 'application/json' });
    res.end(JSON.stringify(body));
  };
  const server = createServer((req, res) => {
    const url = new URL(req.url ?? '/', `http://localhost:${port}`);
    if (url.pathname === '/stats') return send(res, 200, stats);
    if (url.pathname.startsWith('/files/')) {
      res.writeHead(200, { 'content-type': 'application/x-subrip' });
      return res.end(shiftSrt(readFileSync(join(root, 'sample.srt'), 'utf8'), SHIFT));
    }
    stats.lastHeaders = req.headers;
    const key = req.headers['api-key'];
    if (!key) return send(res, 401, { message: 'Api-Key missing' });
    if (key === 'e2e-bad') return send(res, 401, { message: 'Invalid API key' });

    if (url.pathname === '/api/v1/subtitles' && req.method === 'GET') {
      stats.searches++;
      stats.lastQuery = url.search;
      return send(res, 200, {
        total_count: 2,
        data: [
          {
            id: '1',
            type: 'subtitle',
            attributes: {
              language: 'en',
              release: 'Maple.Street.S01E03.Bakery.Cut',
              download_count: 321,
              hearing_impaired: false,
              fps: 23.976,
              files: [{ file_id: 42, file_name: 'Maple.Street.S01E03.Bakery.Cut.srt' }],
              feature_details: {
                feature_type: 'Episode',
                title: 'The Inspection',
                parent_title: 'Maple Street',
                year: 2020,
                season_number: 1,
                episode_number: 3,
              },
            },
          },
          {
            id: '2',
            type: 'subtitle',
            attributes: {
              language: 'en',
              release: 'Maple.Street.S01E03.HI',
              download_count: 12,
              hearing_impaired: true,
              files: [{ file_id: 43, file_name: 'Maple.Street.S01E03.HI.srt' }],
              feature_details: {
                feature_type: 'Episode',
                parent_title: 'Maple Street',
                season_number: 1,
                episode_number: 3,
              },
            },
          },
        ],
      });
    }
    let raw = '';
    req.on('data', (c) => (raw += c));
    req.on('end', () => {
      if (url.pathname === '/api/v1/download' && req.method === 'POST') {
        if (String(key).includes('quota')) {
          return send(res, 406, { message: 'You have downloaded your allowed 5 subtitles for 24h.' });
        }
        stats.downloads++;
        const { file_id } = JSON.parse(raw || '{}');
        return send(res, 200, {
          link: `http://localhost:${port}/files/${file_id}.srt`,
          file_name: `Maple.Street.S01E03.${file_id}.srt`,
          remaining: 9,
        });
      }
      if (url.pathname === '/api/v1/login' && req.method === 'POST') {
        return send(res, 200, { token: 'e2e-token', user: { allowed_downloads: 20 } });
      }
      send(res, 404, { message: 'not found' });
    });
  });
  return new Promise((resolve) => server.listen(port, () => resolve({ server, stats })));
}
