import type { Level, OutLang, ProviderId } from '../storage/settings';
import type { MediaInfo } from '../subtitles/types';

export type ExplainType =
  'slang' | 'idiom' | 'wordplay' | 'reference' | 'character' | 'grammar' | 'literal' | 'other';

export const EXPLAIN_TYPES: readonly ExplainType[] = [
  'slang',
  'idiom',
  'wordplay',
  'reference',
  'character',
  'grammar',
  'literal',
  'other',
];

export type Confidence = 'high' | 'medium' | 'low';
export type ExplainMode = 'short' | 'detailed';

export interface TranscriptLine {
  id: number;
  speaker?: string;
  text: string;
}

export interface ExplainRequest {
  media: MediaInfo;
  transcriptHash: string;
  /** Already cut to the token budget. Sound/music cues are included as context. */
  transcript: TranscriptLine[];
  target: { cueId: number; focusText?: string };
  prev: number[];
  next: number[];
  level: Level;
  outLang: OutLang;
  mode: ExplainMode;
  onlyPast: boolean;
}

export interface ExplainResult {
  text: string;
  type: ExplainType;
  confidence: Confidence;
  expr?: string;
}

export interface ModelInfo {
  id: string;
  label: string;
}

export interface ProviderConfig {
  id: ProviderId;
  apiKey: string;
  model: string;
  baseUrl?: string;
}

/** FR-A1. Network calls only from the background. */
export interface Provider {
  readonly id: ProviderId;
  explain(req: ExplainRequest, signal: AbortSignal): AsyncIterable<string>;
  listModels(signal?: AbortSignal): Promise<ModelInfo[]>;
}

export type ProviderErrorCode =
  | 'no-key'
  | 'bad-key'
  | 'rate-limit'
  | 'network'
  | 'timeout'
  | 'empty'
  | 'bad-response'
  | 'server'
  | 'blocked'
  | 'no-permission'
  | 'aborted';

export class ProviderError extends Error {
  constructor(
    readonly code: ProviderErrorCode,
    message: string,
    readonly status?: number,
    /** Seconds, from Retry-After or the API's retry hint. */
    readonly retryAfter?: number,
  ) {
    super(message);
    this.name = 'ProviderError';
  }

  get retryable(): boolean {
    return this.code === 'rate-limit' || this.code === 'server';
  }
}
