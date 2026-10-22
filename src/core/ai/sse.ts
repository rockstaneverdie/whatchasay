export interface SSEEvent {
  event?: string;
  data: string;
  id?: string;
}

/**
 * FR-A7: incremental Server-Sent Events parser. Accepts text in arbitrary pieces —
 * an event, a line or a CRLF pair may be split across chunks.
 */
export class SSEParser {
  private buf = '';
  private data: string[] = [];
  private event: string | undefined;
  private id: string | undefined;
  /** A chunk ended in '\r'; a following '\n' belongs to the same line break. */
  private pendingCR = false;

  push(chunk: string): SSEEvent[] {
    const out: SSEEvent[] = [];
    let text = chunk;
    if (this.pendingCR && text.startsWith('\n')) text = text.slice(1);
    this.pendingCR = false;
    this.buf += text;

    let start = 0;
    for (let i = 0; i < this.buf.length; i++) {
      const ch = this.buf[i];
      if (ch !== '\n' && ch !== '\r') continue;
      this.line(this.buf.slice(start, i), out);
      if (ch === '\r') {
        if (i + 1 < this.buf.length) {
          if (this.buf[i + 1] === '\n') i++;
        } else {
          this.pendingCR = true;
        }
      }
      start = i + 1;
    }
    this.buf = this.buf.slice(start);
    return out;
  }

  /** End of stream: a final event without a trailing blank line still counts. */
  end(): SSEEvent[] {
    const out: SSEEvent[] = [];
    if (this.buf) this.line(this.buf, out);
    this.buf = '';
    this.dispatch(out);
    return out;
  }

  private line(line: string, out: SSEEvent[]) {
    if (line === '') {
      this.dispatch(out);
      return;
    }
    if (line.startsWith(':')) return;
    const colon = line.indexOf(':');
    const field = colon === -1 ? line : line.slice(0, colon);
    let value = colon === -1 ? '' : line.slice(colon + 1);
    if (value.startsWith(' ')) value = value.slice(1);
    if (field === 'data') this.data.push(value);
    else if (field === 'event') this.event = value;
    else if (field === 'id') this.id = value;
  }

  private dispatch(out: SSEEvent[]) {
    if (this.data.length > 0) {
      out.push({
        data: this.data.join('\n'),
        ...(this.event ? { event: this.event } : {}),
        ...(this.id ? { id: this.id } : {}),
      });
    }
    this.data = [];
    this.event = undefined;
  }
}

/** Bytes → events. The streaming TextDecoder keeps multi-byte characters split across chunks intact. */
export async function* readSSE(
  body: ReadableStream<Uint8Array>,
  signal?: AbortSignal,
): AsyncGenerator<SSEEvent> {
  const reader = body.getReader();
  const decoder = new TextDecoder('utf-8');
  const parser = new SSEParser();
  try {
    for (;;) {
      if (signal?.aborted) throw signal.reason ?? new DOMException('Aborted', 'AbortError');
      const { done, value } = await reader.read();
      if (done) break;
      yield* parser.push(decoder.decode(value, { stream: true }));
    }
    yield* parser.push(decoder.decode());
    yield* parser.end();
  } finally {
    reader.releaseLock();
  }
}
