export type CueKind = 'speech' | 'sound' | 'music';

/** Seconds, relative to media time. */
export interface WordTiming {
  text: string;
  start: number;
  end: number;
}

export interface Cue {
  id: number;
  start: number;
  end: number;
  /** Lines joined with a space; what the AI sees. */
  text: string;
  /** Display lines (dash dialogue lines stay separate). */
  lines: string[];
  speaker?: string;
  kind: CueKind;
  /** Real word timings (ASR). When absent they are interpolated. */
  words?: WordTiming[];
}

export type TrackSource = 'file' | 'dom-track' | 'intercepted' | 'opensubtitles' | 'asr';

export interface Track {
  id: string;
  label: string;
  lang?: string;
  source: TrackSource;
  cues: Cue[];
  offsetMs: number;
}

export interface MediaInfo {
  title?: string;
  season?: number;
  episode?: number;
  year?: number;
  synopsis?: string;
}

/** Cue as it comes out of a format parser, before normalisation. */
export interface RawCue {
  start: number;
  end: number;
  text: string;
}
