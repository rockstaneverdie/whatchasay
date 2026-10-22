import type { Settings } from '../storage/settings';
import type { MediaInfo, Track } from '../subtitles/types';
import { formatTranscriptLine } from './prompt';
import type { ExplainMode, ExplainRequest, TranscriptLine } from './types';

/** FR-C2: rough token estimate. */
export const estimateTokens = (chars: number) => Math.ceil(chars / 4);

const NEIGHBOURS = 3;

function linesTokens(lines: TranscriptLine[]): number {
  return estimateTokens(lines.reduce((n, l) => n + formatTranscriptLine(l).length + 1, 0));
}

/**
 * A window of ±n cues around `index`. Starts are snapped to a grid of n/2 so that
 * neighbouring targets get the very same window — and the same cacheable prefix.
 */
export function windowAround(length: number, index: number, n: number): [number, number] {
  const step = Math.max(1, Math.floor(n / 2));
  let start = Math.max(0, Math.floor((index - n) / step) * step);
  if (index - start > 2 * n) start = index - n;
  const end = Math.min(length, start + 2 * n + step + 1);
  return [start, Math.max(end, Math.min(length, index + 1))];
}

export interface ContextInput {
  track: Track;
  cueIndex: number;
  focusText?: string;
  media: MediaInfo;
  settings: Pick<Settings, 'level' | 'outLang' | 'contextBudgetTokens' | 'contextWindowCues' | 'onlyPast'>;
  mode: ExplainMode;
}

/** FR-C1…C5: what the model sees for one explanation. */
export function buildExplainRequest(input: ContextInput): ExplainRequest {
  const { track, cueIndex, settings } = input;
  const cues = track.cues;
  const target = cues[cueIndex];
  if (!target) throw new Error(`no cue at index ${cueIndex}`);

  const all: TranscriptLine[] = cues.map((c) => ({
    id: c.id,
    ...(c.speaker ? { speaker: c.speaker } : {}),
    text: c.text,
  }));

  // FR-C3: "only the past" cuts the transcript at the target line.
  const lastIndex = settings.onlyPast ? cueIndex + 1 : all.length;
  let lines = all.slice(0, lastIndex);

  if (linesTokens(lines) > settings.contextBudgetTokens) {
    let n = settings.contextWindowCues;
    for (;;) {
      const [s, e] = windowAround(lastIndex, cueIndex, n);
      lines = all.slice(s, e);
      if (linesTokens(lines) <= settings.contextBudgetTokens || n <= NEIGHBOURS) break;
      n = Math.max(NEIGHBOURS, Math.floor(n / 2));
    }
  }

  const ids = new Set(lines.map((l) => l.id));
  const prev = cues
    .slice(Math.max(0, cueIndex - NEIGHBOURS), cueIndex)
    .map((c) => c.id)
    .filter((id) => ids.has(id));
  const next = settings.onlyPast
    ? []
    : cues
        .slice(cueIndex + 1, cueIndex + 1 + NEIGHBOURS)
        .map((c) => c.id)
        .filter((id) => ids.has(id));

  const focus = input.focusText?.trim();
  return {
    media: input.media,
    transcriptHash: track.id,
    transcript: lines,
    target: { cueId: target.id, ...(focus ? { focusText: focus } : {}) },
    prev,
    next,
    level: settings.level,
    outLang: settings.outLang,
    mode: input.mode,
    onlyPast: settings.onlyPast,
  };
}
