import type { Cue, CueKind, RawCue } from './types';

const NAMED_ENTITIES: Record<string, string> = {
  amp: '&',
  lt: '<',
  gt: '>',
  quot: '"',
  apos: "'",
  nbsp: ' ',
  hellip: '…',
  mdash: '—',
  ndash: '–',
  lsquo: '‘',
  rsquo: '’',
  ldquo: '“',
  rdquo: '”',
};

export function decodeEntities(s: string): string {
  return s.replace(/&(#x[0-9a-f]+|#\d+|[a-z]+);/gi, (m, body: string) => {
    if (body[0] === '#') {
      const code =
        body[1] === 'x' || body[1] === 'X' ? parseInt(body.slice(2), 16) : parseInt(body.slice(1), 10);
      return Number.isFinite(code) && code > 0 && code <= 0x10ffff ? String.fromCodePoint(code) : m;
    }
    return NAMED_ENTITIES[body.toLowerCase()] ?? m;
  });
}

const VOICE_RE = /<v(?:\.[^\s>]*)?\s+([^>]+)>/i;

/** Strips formatting tags (`<i> <b> <u> <font>`, VTT `<c>`/`<v>`/timestamps), ASS codes, entities. */
export function cleanLine(line: string): string {
  return decodeEntities(
    line
      .replace(/\{\\[^}]*\}/g, '')
      .replace(/<\/?(?:i|b|u|s|font|c|v|ruby|rt|lang)(?:[\s.][^>]*)?>/gi, '')
      .replace(/<\d{1,2}:\d{2}(?::\d{2})?[.,]\d{1,3}>/g, ''),
  )
    .replace(/[\u200B\uFEFF]/g, '')
    .replace(/\s+/g, ' ')
    .trim();
}

const SPEAKER_RE = /^([A-Z][A-Z0-9 .'&-]{0,30}?):\s*(.*)$/;

function splitSpeaker(line: string): { speaker?: string; rest: string } {
  const m = SPEAKER_RE.exec(line);
  // Require at least two letters so "A: …" style list markers or times like "10:30" are left alone.
  if (m && /[A-Z].*[A-Z]/.test(m[1]!) && m[2]) return { speaker: m[1]!.trim(), rest: m[2] };
  return { rest: line };
}

function classify(lines: string[]): CueKind {
  const joined = lines.join(' ');
  if (/[♪♫]/.test(joined) || lines.every((l) => l.startsWith('#'))) return 'music';
  const stripped = lines.map((l) => l.replace(/^-\s*/, ''));
  if (stripped.every((l) => /^\[[^\]]*\]$|^\([^)]*\)$/.test(l))) return 'sound';
  return 'speech';
}

interface Prepared {
  start: number;
  end: number;
  lines: string[];
  speaker?: string;
  kind: CueKind;
}

function prepare(raw: RawCue): Prepared | null {
  if (!(raw.end > raw.start)) return null;

  let voice: string | undefined;
  const rawLines = raw.text.split('\n').map((l) => {
    const v = VOICE_RE.exec(l);
    if (v && !voice) voice = cleanLine(v[1]!);
    return cleanLine(l);
  });
  const cleaned = rawLines.filter((l) => l.length > 0);
  if (cleaned.length === 0) return null;

  // Dash dialogue: each "- …" starts its own display line; other lines are soft wraps.
  const dashed = cleaned.length > 1 && cleaned.some((l) => /^-\s?\S/.test(l));
  let lines: string[];
  if (dashed) {
    lines = [];
    for (const l of cleaned) {
      if (/^-/.test(l) || lines.length === 0) lines.push(l.replace(/^-\s*/, '- ').trim());
      else lines[lines.length - 1] += ' ' + l;
    }
  } else {
    lines = [cleaned.join(' ').replace(/^-\s*/, '')];
  }

  // Speaker prefixes. One speaker for the cue → pull it out; several → keep them inline.
  const found = new Set<string>();
  const stripped = lines.map((l) => {
    const dash = l.startsWith('- ') ? '- ' : '';
    const { speaker, rest } = splitSpeaker(l.slice(dash.length));
    if (speaker) found.add(speaker);
    return { dash, speaker, rest };
  });
  let speaker = voice;
  if (found.size === 1 && stripped.every((s) => s.speaker || stripped.length === 1)) {
    speaker = [...found][0];
    lines = stripped.map((s) => s.dash + s.rest);
  }

  return { start: raw.start, end: raw.end, lines, speaker, kind: classify(lines) };
}

/** Max gap (s) between two identical consecutive cues that are merged into one. */
const MERGE_GAP = 0.25;

/** FR-S3 / TZ 6.3. Returns cues sorted by start with ids 1..n. */
export function normalizeCues(raw: RawCue[]): Cue[] {
  const prepared = raw
    .map(prepare)
    .filter((c): c is Prepared => c !== null)
    .map((c, i) => ({ c, i }))
    .sort((a, b) => a.c.start - b.c.start || a.i - b.i)
    .map(({ c }) => c);

  const merged: Prepared[] = [];
  for (const c of prepared) {
    const prev = merged[merged.length - 1];
    if (prev && prev.lines.join('\n') === c.lines.join('\n') && c.start - prev.end <= MERGE_GAP) {
      prev.end = Math.max(prev.end, c.end);
      continue;
    }
    merged.push({ ...c });
  }

  return merged.map((c, i) => ({
    id: i + 1,
    start: c.start,
    end: c.end,
    lines: c.lines,
    text: c.lines.join(' '),
    ...(c.speaker ? { speaker: c.speaker } : {}),
    kind: c.kind,
  }));
}
