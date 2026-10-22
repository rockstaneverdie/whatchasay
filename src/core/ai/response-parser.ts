import { EXPLAIN_TYPES, type Confidence, type ExplainResult, type ExplainType } from './types';

const CONFIDENCES: readonly Confidence[] = ['high', 'medium', 'low'];

/**
 * TZ 8.3: splits the streamed answer into visible text and `@@KEY: value` meta lines.
 * Everything before the first `@@` is text and is streamed; meta is never shown.
 */
export class ResponseParser {
  private text = '';
  private held = '';
  private meta = '';
  private inMeta = false;

  /** Feeds a chunk; returns the newly visible text (may be empty). */
  push(chunk: string): string {
    if (this.inMeta) {
      this.meta += chunk;
      return '';
    }
    const pending = this.held + chunk;
    this.held = '';
    const at = pending.indexOf('@@');
    if (at >= 0) {
      this.inMeta = true;
      this.meta = pending.slice(at);
      return this.emit(pending.slice(0, at));
    }
    // A lone trailing '@' may be the first half of '@@'.
    if (pending.endsWith('@')) {
      this.held = '@';
      return this.emit(pending.slice(0, -1));
    }
    return this.emit(pending);
  }

  private emit(s: string): string {
    this.text += s;
    return s;
  }

  finish(): ExplainResult {
    if (!this.inMeta) this.text += this.held;
    this.held = '';
    const fields = new Map<string, string>();
    for (const m of this.meta.matchAll(/@@\s*([A-Z_]+)\s*:\s*([^\n@]*)/gi)) {
      fields.set(m[1]!.toUpperCase(), m[2]!.trim());
    }
    const rawType = (fields.get('TYPE') ?? '').toLowerCase().split(/[\s|,]/)[0] ?? '';
    const rawConf = (fields.get('CONFIDENCE') ?? '').toLowerCase().split(/[\s|,]/)[0] ?? '';
    const expr = fields
      .get('EXPR')
      ?.replace(/^["'“‘]+|["'”’]+$/g, '')
      .trim();
    return {
      text: this.text.trim(),
      type: (EXPLAIN_TYPES as readonly string[]).includes(rawType) ? (rawType as ExplainType) : 'other',
      confidence: (CONFIDENCES as readonly string[]).includes(rawConf) ? (rawConf as Confidence) : 'medium',
      ...(expr && expr.toLowerCase() !== 'none' ? { expr } : {}),
    };
  }
}

/** NFR-4: the only markup we render — `**bold**` — as plain segments. */
export function splitBold(text: string): { text: string; bold: boolean }[] {
  const out: { text: string; bold: boolean }[] = [];
  const re = /\*\*([^*]+?)\*\*/g;
  let last = 0;
  for (const m of text.matchAll(re)) {
    if (m.index! > last) out.push({ text: text.slice(last, m.index), bold: false });
    out.push({ text: m[1]!, bold: true });
    last = m.index! + m[0].length;
  }
  if (last < text.length) out.push({ text: text.slice(last), bold: false });
  return out;
}
