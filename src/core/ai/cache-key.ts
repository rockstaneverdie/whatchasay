import { sha256Hex } from '../../utils/hash';
import { PROMPT_VERSION } from './prompt';
import type { ExplainRequest } from './types';

/** FR-K1: sha256(transcriptHash | cueId | focusText | level | outLang | mode | promptVersion | providerId). */
export function cacheKey(
  req: ExplainRequest,
  providerId: string,
  promptVersion = PROMPT_VERSION,
): Promise<string> {
  const focus = (req.target.focusText ?? '').replace(/\s+/g, ' ').trim().toLowerCase();
  return sha256Hex(
    [
      req.transcriptHash,
      req.target.cueId,
      focus,
      req.level,
      req.outLang,
      req.mode,
      promptVersion,
      providerId,
    ].join('|'),
  );
}
