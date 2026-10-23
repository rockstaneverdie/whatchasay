/**
 * Prompt quality eval (TZ 8.4). Runs eval/cases.json through a provider and prints a table:
 * format kept, length, no spoilers, injection ignored, type. The gist is checked by hand
 * from the Markdown report in eval/reports/.
 *
 *   GEMINI_API_KEY=… pnpm eval                       # Gemini (default model from settings)
 *   EVAL_PROVIDER=openai OPENAI_BASE_URL=… OPENAI_MODEL=… [OPENAI_API_KEY=…] pnpm eval
 *   pnpm eval --mock                                 # dry run of the pipeline, no network
 *   pnpm eval --only pun,inject                      # id prefixes
 */
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { buildExplainRequest } from '../src/core/ai/context';
import { PROMPT_VERSION } from '../src/core/ai/prompt';
import { GeminiProvider } from '../src/core/ai/provider-gemini';
import { OpenAICompatProvider } from '../src/core/ai/provider-openai-compat';
import { ResponseParser } from '../src/core/ai/response-parser';
import type { ExplainRequest, Provider } from '../src/core/ai/types';
import { DEFAULT_SETTINGS, type Level, type OutLang } from '../src/core/storage/settings';
import type { Cue, MediaInfo, Track } from '../src/core/subtitles/types';

interface EvalCase {
  id: string;
  category: string;
  expectedType: string;
  show: MediaInfo;
  lines: [string, string][];
  target: number;
  focus?: string;
  gist: string;
  expectConfidence?: 'high' | 'medium' | 'low';
  mustNotContain: string[];
}

interface Row {
  id: string;
  format: boolean;
  words: number;
  lengthOk: boolean;
  noLeak: boolean;
  type: string;
  typeOk: boolean;
  confidence: string;
  confidenceOk: boolean;
  ms: number;
  answer: string;
  gist: string;
  error?: string;
}

const here = dirname(fileURLToPath(import.meta.url));
const args = process.argv.slice(2);
const mock = args.includes('--mock');
const only = args.includes('--only') ? (args[args.indexOf('--only') + 1] ?? '').split(',') : [];
const level = (process.env.EVAL_LEVEL ?? 'B1') as Level;
const outLang = (process.env.EVAL_LANG ?? 'ru') as OutLang;

function caseToTrack(c: EvalCase): Track {
  const cues: Cue[] = c.lines.map(([speaker, text], i) => ({
    id: i + 1,
    start: i * 3,
    end: i * 3 + 2.5,
    text,
    lines: [text],
    speaker,
    kind: 'speech',
  }));
  return { id: `eval-${c.id}`, label: c.id, source: 'file', cues, offsetMs: 0 };
}

/** Deterministic stand-in to exercise the pipeline without a key. */
class MockProvider implements Provider {
  readonly id = 'gemini' as const;
  async *explain(req: ExplainRequest): AsyncGenerator<string> {
    const target = req.transcript.find((l) => l.id === req.target.cueId);
    yield `Mock: «${req.target.focusText ?? target?.text ?? ''}» `;
    yield 'means something in this scene.\n@@TYPE: other\n@@CONFIDENCE: medium\n@@EXPR: x';
  }
  async listModels() {
    return [];
  }
}

function makeProvider(): { provider: Provider; label: string; delayMs: number } {
  if (mock) return { provider: new MockProvider(), label: 'mock', delayMs: 0 };
  const which = process.env.EVAL_PROVIDER ?? 'gemini';
  if (which === 'openai') {
    const baseUrl = process.env.OPENAI_BASE_URL;
    const model = process.env.OPENAI_MODEL;
    if (!baseUrl || !model) throw new Error('set OPENAI_BASE_URL and OPENAI_MODEL');
    return {
      provider: new OpenAICompatProvider({ baseUrl, model, apiKey: process.env.OPENAI_API_KEY ?? '' }),
      label: `openai-compat ${model}`,
      delayMs: Number(process.env.EVAL_DELAY_MS ?? 1500),
    };
  }
  const apiKey = process.env.GEMINI_API_KEY;
  if (!apiKey) throw new Error('set GEMINI_API_KEY (or use --mock / EVAL_PROVIDER=openai)');
  const model = process.env.GEMINI_MODEL ?? DEFAULT_SETTINGS.gemini.model;
  // Free tier is rate limited; space the requests out.
  return {
    provider: new GeminiProvider({ apiKey, model }),
    label: `gemini ${model}`,
    delayMs: Number(process.env.EVAL_DELAY_MS ?? 4500),
  };
}

async function runCase(provider: Provider, c: EvalCase): Promise<Row> {
  const req = buildExplainRequest({
    track: caseToTrack(c),
    cueIndex: c.target,
    ...(c.focus ? { focusText: c.focus } : {}),
    media: c.show,
    settings: { ...DEFAULT_SETTINGS, level, outLang },
    mode: 'short',
  });
  const parser = new ResponseParser();
  let raw = '';
  const t0 = Date.now();
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), 60_000);
  try {
    for await (const chunk of provider.explain(req, ctrl.signal)) {
      raw += chunk;
      parser.push(chunk);
    }
  } finally {
    clearTimeout(timer);
  }
  const result = parser.finish();
  const words = result.text.split(/\s+/).filter(Boolean).length;
  const lower = raw.toLowerCase();
  const leak = c.mustNotContain.some((s) => lower.includes(s.toLowerCase()));
  return {
    id: c.id,
    format: /@@TYPE\s*:/i.test(raw) && /@@CONFIDENCE\s*:/i.test(raw) && result.text.length > 0,
    words,
    lengthOk: words <= 60,
    noLeak: !leak,
    type: result.type,
    typeOk: result.type === c.expectedType || c.expectedType === 'other',
    confidence: result.confidence,
    confidenceOk: !c.expectConfidence || result.confidence === c.expectConfidence,
    ms: Date.now() - t0,
    answer: result.text,
    gist: c.gist,
  };
}

const mark = (b: boolean) => (b ? 'ok' : 'FAIL');

async function main() {
  const data = JSON.parse(readFileSync(join(here, 'cases.json'), 'utf8')) as { cases: EvalCase[] };
  const cases = data.cases.filter((c) => !only.length || only.some((p) => c.id.startsWith(p)));
  const { provider, label, delayMs } = makeProvider();
  console.log(
    `WhatchaSay? eval · ${label} · prompt ${PROMPT_VERSION} · level ${level} · lang ${outLang} · ${cases.length} cases\n`,
  );

  const rows: Row[] = [];
  for (const [i, c] of cases.entries()) {
    if (i > 0 && delayMs) await new Promise((r) => setTimeout(r, delayMs));
    try {
      rows.push(await runCase(provider, c));
    } catch (e) {
      rows.push({
        id: c.id,
        format: false,
        words: 0,
        lengthOk: false,
        noLeak: true,
        type: '-',
        typeOk: false,
        confidence: '-',
        confidenceOk: false,
        ms: 0,
        answer: '',
        gist: c.gist,
        error: e instanceof Error ? `${e.name}: ${e.message}` : String(e),
      });
    }
    const r = rows.at(-1)!;
    console.log(
      [
        r.id.padEnd(12),
        `format ${mark(r.format)}`.padEnd(12),
        `len ${String(r.words).padStart(3)} ${mark(r.lengthOk)}`.padEnd(12),
        `leak ${mark(r.noLeak)}`.padEnd(10),
        `type ${r.type}${r.typeOk ? '' : ' (≠)'}`.padEnd(22),
        `conf ${r.confidence}${r.confidenceOk ? '' : ' (≠)'}`.padEnd(14),
        `${r.ms} ms`,
        r.error ? `  ERROR ${r.error}` : '',
      ].join(' '),
    );
  }

  const pct = (f: (r: Row) => boolean) => `${rows.filter(f).length}/${rows.length}`;
  const summary = {
    format: pct((r) => r.format),
    length: pct((r) => r.lengthOk),
    noSpoilerOrInjection: pct((r) => r.noLeak),
    typeMatch: pct((r) => r.typeOk),
    confidence: pct((r) => r.confidenceOk),
    errors: rows.filter((r) => r.error).length,
  };
  console.log('\nSummary', summary);

  const outDir = join(here, 'reports');
  mkdirSync(outDir, { recursive: true });
  const stamp = new Date().toISOString().replace(/[:.]/g, '-');
  const md = [
    `# WhatchaSay? eval — ${label}`,
    '',
    `Prompt ${PROMPT_VERSION} · level ${level} · lang ${outLang} · ${new Date().toISOString()}`,
    '',
    '| metric | result |',
    '|---|---|',
    ...Object.entries(summary).map(([k, v]) => `| ${k} | ${v} |`),
    '',
    '## Answers (check the gist by hand)',
    '',
    ...rows.flatMap((r) => [
      `### ${r.id} — ${r.type} / ${r.confidence}${r.error ? ' — ERROR' : ''}`,
      '',
      `**Expected gist:** ${r.gist}`,
      '',
      `**Answer:** ${r.error ?? r.answer}`,
      '',
    ]),
  ].join('\n');
  const file = join(outDir, `${stamp}.md`);
  writeFileSync(file, md);
  console.log(`\nReport: ${file}`);
  if (summary.errors === rows.length) process.exitCode = 1;
}

main().catch((e) => {
  console.error(e instanceof Error ? e.message : e);
  process.exit(1);
});
