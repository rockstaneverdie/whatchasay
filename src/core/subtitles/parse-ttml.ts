import type { RawCue } from './types';

/** TTML/DFXP time expressions: clock (`00:00:01.5`, `00:00:01:12` frames) or offset (`1.5s`, `150ms`, `45t`). */
export function parseTtmlTime(value: string, frameRate = 30, tickRate = 1): number | null {
  const v = value.trim();
  const clock = /^(\d+):(\d{2}):(\d{2})(?:([.,]\d+)|:(\d+(?:\.\d+)?))?$/.exec(v);
  if (clock) {
    const [, h, m, s, frac, frames] = clock;
    let t = Number(h) * 3600 + Number(m) * 60 + Number(s);
    if (frac) t += Number(frac.replace(',', '.'));
    if (frames) t += Number(frames) / frameRate;
    return t;
  }
  const offset = /^(\d+(?:\.\d+)?)(h|m|s|ms|f|t)$/.exec(v);
  if (!offset) return null;
  const n = Number(offset[1]);
  switch (offset[2]) {
    case 'h':
      return n * 3600;
    case 'm':
      return n * 60;
    case 's':
      return n;
    case 'ms':
      return n / 1000;
    case 'f':
      return n / frameRate;
    default:
      return n / tickRate;
  }
}

function attr(el: Element, name: string): string | null {
  // Namespaced attributes (ttp:frameRate) are matched by local name.
  for (const a of Array.from(el.attributes)) {
    if (a.localName === name || a.name === name || a.name.endsWith(`:${name}`)) return a.value;
  }
  return null;
}

function textOf(node: Node): string {
  let out = '';
  for (const child of Array.from(node.childNodes)) {
    if (child.nodeType === 3) out += (child.textContent ?? '').replace(/\s+/g, ' ');
    else if (child.nodeType === 1) {
      const el = child as Element;
      out += el.localName === 'br' ? '\n' : textOf(el);
    }
  }
  return out;
}

/**
 * Minimal TTML / DFXP reader: `<p begin end|dur>` with nested spans and `<br/>`.
 * Inherited timing from `<div>`/`<body>` begin is added; styling and regions are ignored.
 */
export function parseTtml(xml: string): RawCue[] {
  const doc = new DOMParser().parseFromString(xml, 'application/xml');
  if (doc.getElementsByTagName('parsererror').length > 0) return [];
  const root = doc.documentElement;
  if (!root || root.localName !== 'tt') return [];
  const [num, den] = (attr(root, 'frameRateMultiplier') ?? '1 1').split(/\s+/).map(Number);
  const frameRate = (Number(attr(root, 'frameRate')) || 30) * (num && den ? num / den : 1);
  const tickRate = Number(attr(root, 'tickRate')) || frameRate;

  const out: RawCue[] = [];
  // By local name, so prefixed documents (`<tt:p>`) work too.
  const ps = Array.from(root.getElementsByTagName('*')).filter((el) => el.localName === 'p');
  for (const p of ps) {
    let base = 0;
    for (let a = p.parentElement; a && a !== root; a = a.parentElement) {
      const b = attr(a, 'begin');
      if (b) base += parseTtmlTime(b, frameRate, tickRate) ?? 0;
    }
    const begin = attr(p, 'begin');
    const end = attr(p, 'end');
    const dur = attr(p, 'dur');
    const start = begin ? parseTtmlTime(begin, frameRate, tickRate) : null;
    if (start === null) continue;
    let stop = end ? parseTtmlTime(end, frameRate, tickRate) : null;
    if (stop === null && dur) {
      const d = parseTtmlTime(dur, frameRate, tickRate);
      if (d !== null) stop = start + d;
    }
    if (stop === null) continue;
    const text = textOf(p)
      .split('\n')
      .map((l) => l.trim())
      .filter(Boolean)
      .join('\n');
    if (text) out.push({ start: base + start, end: base + stop, text });
  }
  return out;
}
