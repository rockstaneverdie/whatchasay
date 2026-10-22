import { describe, expect, it } from 'vitest';
import { ResponseParser, splitBold } from '../../src/core/ai/response-parser';

const ANSWER =
  'Here **back to square one** means they are starting over after a failure.\n' +
  '@@TYPE: idiom\n@@CONFIDENCE: high\n@@EXPR: back to square one\n';

function feed(chunks: string[]) {
  const p = new ResponseParser();
  const visible = chunks.map((c) => p.push(c)).join('');
  return { visible, result: p.finish() };
}

describe('ResponseParser', () => {
  it('streams text and hides meta lines, whatever the chunking', () => {
    for (let size = 1; size <= ANSWER.length; size += 3) {
      const chunks: string[] = [];
      for (let i = 0; i < ANSWER.length; i += size) chunks.push(ANSWER.slice(i, i + size));
      const { visible, result } = feed(chunks);
      expect(visible).not.toContain('@');
      expect(visible.trim()).toBe(result.text);
      expect(result).toEqual({
        text: 'Here **back to square one** means they are starting over after a failure.',
        type: 'idiom',
        confidence: 'high',
        expr: 'back to square one',
      });
    }
  });

  it('defaults to other/medium without meta', () => {
    const { result } = feed(['Just ', 'text.']);
    expect(result).toEqual({ text: 'Just text.', type: 'other', confidence: 'medium' });
  });

  it('maps invalid TYPE to other and invalid CONFIDENCE to medium', () => {
    const { result } = feed(['x\n@@TYPE: pun\n@@CONFIDENCE: very']);
    expect(result.type).toBe('other');
    expect(result.confidence).toBe('medium');
  });

  it('accepts meta that starts mid-line and odd spacing/case', () => {
    const { visible, result } = feed([
      'A joke about bread. @@type :  wordplay\n@@ confidence: LOW\n@@EXPR: "knead"',
    ]);
    expect(visible).toBe('A joke about bread. ');
    expect(result).toMatchObject({ type: 'wordplay', confidence: 'low', expr: 'knead' });
  });

  it('keeps a single @ that is not meta', () => {
    const { visible, result } = feed(['email me @', ' home']);
    expect(visible).toBe('email me @ home');
    expect(result.text).toBe('email me @ home');
  });

  it('drops EXPR "none"', () => {
    expect(feed(['ok\n@@TYPE: literal\n@@EXPR: none']).result.expr).toBeUndefined();
  });
});

describe('splitBold', () => {
  it('splits **bold** segments and leaves unmatched markers as text', () => {
    expect(splitBold('a **b** c **d')).toEqual([
      { text: 'a ', bold: false },
      { text: 'b', bold: true },
      { text: ' c **d', bold: false },
    ]);
  });

  it('never produces markup from the input', () => {
    const segs = splitBold('<img src=x onerror=alert(1)> **<b>x</b>**');
    expect(segs.map((s) => s.text).join('')).toContain('<img');
  });
});
