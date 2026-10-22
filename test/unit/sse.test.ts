import { describe, expect, it } from 'vitest';
import { readSSE, SSEParser } from '../../src/core/ai/sse';

function streamOf(chunks: Uint8Array[]): ReadableStream<Uint8Array> {
  return new ReadableStream({
    start(c) {
      for (const ch of chunks) c.enqueue(ch);
      c.close();
    },
  });
}

async function collect(chunks: Uint8Array[]) {
  const out: string[] = [];
  for await (const ev of readSSE(streamOf(chunks))) out.push(ev.data);
  return out;
}

describe('SSEParser', () => {
  it('parses events split at every possible position', () => {
    const raw = 'data: {"a":1}\n\nevent: x\ndata: line1\ndata: line2\n\n: comment\ndata: last\r\n\r\n';
    for (let cut = 0; cut <= raw.length; cut++) {
      const p = new SSEParser();
      const evs = [...p.push(raw.slice(0, cut)), ...p.push(raw.slice(cut)), ...p.end()];
      expect(evs).toEqual([{ data: '{"a":1}' }, { event: 'x', data: 'line1\nline2' }, { data: 'last' }]);
    }
  });

  it('treats a CR at a chunk end and LF at the next start as one break', () => {
    const p = new SSEParser();
    expect([...p.push('data: a\r'), ...p.push('\n\r'), ...p.push('\ndata: b\n\n')]).toEqual([
      { data: 'a' },
      { data: 'b' },
    ]);
  });

  it('flushes a final event without a blank line at end of stream', () => {
    const p = new SSEParser();
    expect(p.push('data: tail')).toEqual([]);
    expect(p.end()).toEqual([{ data: 'tail' }]);
  });

  it('ignores fields other than data/event/id and strips one leading space only', () => {
    const p = new SSEParser();
    expect(p.push('retry: 10\ndata:  two spaces\nfoo: bar\n\n')).toEqual([{ data: ' two spaces' }]);
  });
});

describe('readSSE', () => {
  it('keeps UTF-8 characters intact when bytes are split inside a character', async () => {
    const bytes = new TextEncoder().encode('data: Привет, “мир” 👋\n\n');
    for (let cut = 1; cut < bytes.length; cut++) {
      const out = await collect([bytes.slice(0, cut), bytes.slice(cut)]);
      expect(out).toEqual(['Привет, “мир” 👋']);
    }
  });

  it('handles byte-by-byte delivery', async () => {
    const bytes = new TextEncoder().encode('data: один\n\ndata: два\n\n');
    const out = await collect([...bytes].map((b) => new Uint8Array([b])));
    expect(out).toEqual(['один', 'два']);
  });
});
