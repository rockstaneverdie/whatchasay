import { errorFromFetch, errorFromResponse } from './http-errors';
import { buildSystemPrompt, buildUserMessage } from './prompt';
import { readSSE } from './sse';
import { ProviderError, type ExplainRequest, type ModelInfo, type Provider } from './types';

export const GEMINI_BASE = 'https://generativelanguage.googleapis.com/v1beta';

interface GeminiPart {
  text?: string;
  thought?: boolean;
}

interface GeminiChunk {
  candidates?: { content?: { parts?: GeminiPart[] }; finishReason?: string }[];
  promptFeedback?: { blockReason?: string };
  modelVersion?: string;
}

const BLOCKED_REASONS = new Set(['SAFETY', 'PROHIBITED_CONTENT', 'BLOCKLIST', 'SPII', 'RECITATION', 'OTHER']);

/** Gemini 3+/4 models take `thinkingLevel`; a short explanation needs little thinking. */
export function thinkingConfigFor(model: string): { thinkingLevel: string } | undefined {
  return /^gemini-(?:[3-9]|\d\d)/.test(model) ? { thinkingLevel: 'low' } : undefined;
}

export interface GeminiConfig {
  apiKey: string;
  model: string;
  fetch?: typeof fetch;
}

/** FR-A2: `streamGenerateContent?alt=sse`, key in `x-goog-api-key` (never in the URL). */
export class GeminiProvider implements Provider {
  readonly id = 'gemini' as const;
  private readonly fetch: typeof fetch;

  constructor(private readonly cfg: GeminiConfig) {
    this.fetch = cfg.fetch ?? globalThis.fetch.bind(globalThis);
  }

  private headers(): HeadersInit {
    return { 'content-type': 'application/json', 'x-goog-api-key': this.cfg.apiKey };
  }

  buildBody(req: ExplainRequest, withThinking = true): unknown {
    const thinking = withThinking ? thinkingConfigFor(this.cfg.model) : undefined;
    return {
      systemInstruction: { parts: [{ text: buildSystemPrompt(req.level, req.outLang) }] },
      contents: [{ role: 'user', parts: [{ text: buildUserMessage(req) }] }],
      generationConfig: {
        maxOutputTokens: req.mode === 'detailed' ? 2048 : 1024,
        ...(thinking ? { thinkingConfig: thinking } : {}),
      },
    };
  }

  private async open(req: ExplainRequest, signal: AbortSignal): Promise<Response> {
    const url = `${GEMINI_BASE}/models/${encodeURIComponent(this.cfg.model)}:streamGenerateContent?alt=sse`;
    const send = (withThinking: boolean) =>
      this.fetch(url, {
        method: 'POST',
        headers: this.headers(),
        body: JSON.stringify(this.buildBody(req, withThinking)),
        signal,
      });
    let res: Response;
    try {
      res = await send(true);
      // Older or unusual models reject thinkingConfig; try once without it.
      if (res.status === 400 && thinkingConfigFor(this.cfg.model)) {
        const err = await errorFromResponse(res.clone());
        if (/thinking/i.test(err.message)) res = await send(false);
      }
    } catch (e) {
      throw errorFromFetch(e, signal);
    }
    if (!res.ok) throw await errorFromResponse(res);
    if (!res.body) throw new ProviderError('empty', 'no response body');
    return res;
  }

  async *explain(req: ExplainRequest, signal: AbortSignal): AsyncGenerator<string> {
    if (!this.cfg.apiKey) throw new ProviderError('no-key', 'no Gemini API key');
    const res = await this.open(req, signal);
    let produced = false;
    let finish: string | undefined;
    try {
      for await (const ev of readSSE(res.body!, signal)) {
        let chunk: GeminiChunk;
        try {
          chunk = JSON.parse(ev.data) as GeminiChunk;
        } catch {
          throw new ProviderError('bad-response', 'malformed stream chunk');
        }
        if (chunk.promptFeedback?.blockReason) {
          throw new ProviderError('blocked', chunk.promptFeedback.blockReason);
        }
        const cand = chunk.candidates?.[0];
        finish = cand?.finishReason ?? finish;
        for (const part of cand?.content?.parts ?? []) {
          if (part.thought || !part.text) continue;
          produced = true;
          yield part.text;
        }
      }
    } catch (e) {
      if (e instanceof ProviderError) throw e;
      throw errorFromFetch(e, signal);
    }
    if (!produced) {
      if (finish && BLOCKED_REASONS.has(finish)) throw new ProviderError('blocked', finish);
      throw new ProviderError('empty', `no text (finishReason ${finish ?? 'none'})`);
    }
  }

  async listModels(signal?: AbortSignal): Promise<ModelInfo[]> {
    if (!this.cfg.apiKey) throw new ProviderError('no-key', 'no Gemini API key');
    const ctrl = signal ?? new AbortController().signal;
    const out: ModelInfo[] = [];
    let pageToken: string | undefined;
    do {
      const url = `${GEMINI_BASE}/models?pageSize=1000${pageToken ? `&pageToken=${encodeURIComponent(pageToken)}` : ''}`;
      let res: Response;
      try {
        res = await this.fetch(url, { headers: this.headers(), signal: ctrl });
      } catch (e) {
        throw errorFromFetch(e, ctrl);
      }
      if (!res.ok) throw await errorFromResponse(res);
      const body = (await res.json()) as {
        models?: { name: string; displayName?: string; supportedGenerationMethods?: string[] }[];
        nextPageToken?: string;
      };
      for (const m of body.models ?? []) {
        if (!m.supportedGenerationMethods?.includes('generateContent')) continue;
        const id = m.name.replace(/^models\//, '');
        out.push({ id, label: m.displayName ? `${m.displayName} (${id})` : id });
      }
      pageToken = body.nextPageToken;
    } while (pageToken);
    return out;
  }
}
