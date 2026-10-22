// A tiny OpenAI-compatible server for E2E tests. The model name picks the behaviour:
//   ok     – streams an invented explanation in small chunks, then meta lines
//   slow   – waits 30 s before the first token (first-token timeout is 15 s)
//   rate   – 429 with Retry-After: 30
//   badkey – 401
//   empty  – only meta lines, no explanation text
//   inject – checks that the system prompt marks the transcript as data
// GET /v1/models lists them. GET /stats returns request counters.
import { createServer } from 'node:http';

export function startMockAi(port = 5556) {
  const stats = { requests: 0, aborted: 0, completed: 0, lastBody: null };
  const send = (res, status, body, headers = {}) => {
    res.writeHead(status, {
      'content-type': 'application/json',
      'access-control-allow-origin': '*',
      ...headers,
    });
    res.end(JSON.stringify(body));
  };
  const server = createServer((req, res) => {
    if (req.method === 'OPTIONS') {
      res.writeHead(204, {
        'access-control-allow-origin': '*',
        'access-control-allow-headers': '*',
        'access-control-allow-methods': 'GET, POST',
      });
      return res.end();
    }
    if (req.url === '/stats') return send(res, 200, stats);
    if (req.url === '/v1/models') {
      return send(res, 200, { data: ['ok', 'slow', 'rate', 'badkey', 'empty'].map((id) => ({ id })) });
    }
    if (req.url !== '/v1/chat/completions' || req.method !== 'POST') return send(res, 404, { error: 'nope' });

    let raw = '';
    req.on('data', (c) => (raw += c));
    req.on('end', () => {
      stats.requests++;
      const body = JSON.parse(raw);
      stats.lastBody = body;
      const model = body.model;
      if (model === 'badkey') return send(res, 401, { error: { message: 'Invalid API Key' } });
      if (model === 'rate')
        return send(res, 429, { error: { message: 'Rate limit reached' } }, { 'retry-after': '30' });

      res.writeHead(200, { 'content-type': 'text/event-stream', 'cache-control': 'no-cache' });
      let closed = false;
      res.on('close', () => {
        if (!res.writableEnded) {
          closed = true;
          stats.aborted++;
        }
      });
      const chunk = (text) =>
        res.write(`data: ${JSON.stringify({ choices: [{ delta: { content: text } }] })}\n\n`);

      const answer =
        model === 'empty'
          ? ['@@TYPE: other\n@@CONFIDENCE: low\n']
          : [
              'Здесь ',
              '**back to ',
              'square one** ',
              '— «вернулись к началу»: ',
              'план не сработал, ',
              'и всё придётся начинать заново. ',
              'Майя говорит это с иронией.',
              '\n@@TY',
              'PE: idiom\n@@CONFIDENCE: high\n@@EXPR: back to square one\n',
            ];
      let i = 0;
      const start = model === 'slow' ? 30_000 : 120;
      const tick = () => {
        if (closed) return;
        if (i >= answer.length) {
          res.write('data: [DONE]\n\n');
          res.end();
          stats.completed++;
          return;
        }
        chunk(answer[i++]);
        setTimeout(tick, 90);
      };
      setTimeout(tick, start);
    });
  });
  return new Promise((resolve) => server.listen(port, () => resolve({ server, stats })));
}

if (import.meta.url === `file:///${process.argv[1]?.replace(/\\/g, '/')}`) {
  await startMockAi();
  console.log('mock AI on http://localhost:5556/v1');
}
