import { errorFromFetch, errorFromResponse } from './http-errors';
import { buildSystemPrompt, buildUserMessage } from './prompt';
import { readSSE } from './sse';
import { ProviderError, type ExplainRequest, type ModelInfo, type Provider } from './types';

export interface OpenAICompatConfig {
  baseUrl: string;
  apiKey: string;
  model: string;
  fetch?: typeof fetch;
}

interface ChatChunk {
  choices?: { delta?: { content?: string | null }; finish_reason?: string | null }[];
  error?: { message?: string };
}

export function normalizeBaseUrl(url: string): string {
  return url.trim().replace(/\/+$/, '');
}

/** FR-A3: any `/chat/completions` server — Groq, OpenRouter, Ollama, LM Studio. */
export class OpenAICompatProvider implements Provider {
  readonly id = 'openai-compat' as const;
  private readonly fetch: typeof fetch;
  private readonly base: string;

  constructor(private readonly cfg: OpenAICompatConfig) {
    this.fetch = cfg.fetch ?? globalThis.fetch.bind(globalThis);
    this.base = normalizeBaseUrl(cfg.baseUrl);
  }

  private headers(): Record<string, string> {
    // Local servers (Ollama, LM Studio) need no key.
    return {
      'content-type': 'application/json',
      ...(this.cfg.apiKey ? { authorization: `Bearer ${this.cfg.apiKey}` } : {}),
    };
  }

  buildBody(req: ExplainRequest): unknown {
    return {
      model: this.cfg.model,
      stream: true,
      max_tokens: req.mode === 'detailed' ? 700 : 350,
      messages: [
        { role: 'system', content: buildSystemPrompt(req.level, req.outLang) },
        { role: 'user', content: buildUserMessage(req) },
      ],
    };
  }

  async *explain(req: ExplainRequest, signal: AbortSignal): AsyncGenerator<string> {
    if (!this.base) throw new ProviderError('no-key', 'no base URL');
    if (!this.cfg.model) throw new ProviderError('no-key', 'no model selected');
    let res: Response;
    try {
      res = await this.fetch(`${this.base}/chat/completions`, {
        method: 'POST',
        headers: this.headers(),
        body: JSON.stringify(this.buildBody(req)),
        signal,
      });
    } catch (e) {
      throw errorFromFetch(e, signal);
    }
    if (!res.ok) throw await errorFromResponse(res);
    if (!res.body) throw new ProviderError('empty', 'no response body');
    let produced = false;
    try {
      for await (const ev of readSSE(res.body, signal)) {
        if (ev.data.trim() === '[DONE]') break;
        let chunk: ChatChunk;
        try {
          chunk = JSON.parse(ev.data) as ChatChunk;
        } catch {
          throw new ProviderError('bad-response', 'malformed stream chunk');
        }
        if (chunk.error) throw new ProviderError('server', chunk.error.message ?? 'stream error');
        const text = chunk.choices?.[0]?.delta?.content;
        if (text) {
          produced = true;
          yield text;
        }
      }
    } catch (e) {
      if (e instanceof ProviderError) throw e;
      throw errorFromFetch(e, signal);
    }
    if (!produced) throw new ProviderError('empty', 'no text');
  }

  async listModels(signal?: AbortSignal): Promise<ModelInfo[]> {
    const s = signal ?? new AbortController().signal;
    let res: Response;
    try {
      res = await this.fetch(`${this.base}/models`, { headers: this.headers(), signal: s });
    } catch (e) {
      throw errorFromFetch(e, s);
    }
    if (!res.ok) throw await errorFromResponse(res);
    const body = (await res.json()) as { data?: { id: string }[] };
    return (body.data ?? []).map((m) => ({ id: m.id, label: m.id })).sort((a, b) => a.id.localeCompare(b.id));
  }
}
