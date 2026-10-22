import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { cleanLine, decodeEntities, normalizeCues } from '../../src/core/subtitles/normalize';
import { parseSrt, parseVtt } from '../../src/core/subtitles/parse';

const raw = (text: string, start = 1, end = 2) => ({ start, end, text });

describe('cleanLine', () => {
  it('strips formatting tags, ASS codes and VTT timestamps', () => {
    expect(cleanLine('{\\an8}<i>Hello</i> <font color="#ff0">there</font>')).toBe('Hello there');
    expect(cleanLine('<b><u>Bold</u></b>  move')).toBe('Bold move');
    expect(cleanLine('<c.yellow>The one</c> with <00:00:24.000>carrots')).toBe('The one with carrots');
  });

  it('decodes entities', () => {
    expect(decodeEntities('Tom &amp; Jerry &lt;3 &#39;hi&#39; &#x2014;')).toBe("Tom & Jerry <3 'hi' —");
  });
});

describe('normalizeCues', () => {
  it('pulls a speaker prefix out and joins soft-wrapped lines', () => {
    const [c] = normalizeCues([raw('MAYA: Morning! You look like\nsomething the cat dragged in.')]);
    expect(c).toMatchObject({
      id: 1,
      speaker: 'MAYA',
      lines: ['Morning! You look like something the cat dragged in.'],
      text: 'Morning! You look like something the cat dragged in.',
      kind: 'speech',
    });
  });

  it('keeps dash dialogue as separate lines', () => {
    const [c] = normalizeCues([raw('- Did it work?\n- Define "work".')]);
    expect(c!.lines).toEqual(['- Did it work?', '- Define "work".']);
    expect(c!.speaker).toBeUndefined();
  });

  it('keeps several speakers inline', () => {
    const [c] = normalizeCues([raw('- ANN: Ready?\n- BOB: Nope.')]);
    expect(c!.speaker).toBeUndefined();
    expect(c!.lines).toEqual(['- ANN: Ready?', '- BOB: Nope.']);
  });

  it('does not treat clock times or single letters as speakers', () => {
    expect(normalizeCues([raw('10:30 is fine.')])[0]!.speaker).toBeUndefined();
    expect(normalizeCues([raw('A: the first option')])[0]!.speaker).toBeUndefined();
  });

  it('takes the VTT voice as speaker', () => {
    const [c] = normalizeCues([raw('<v Rosa>Who left the gate open?</v>')]);
    expect(c).toMatchObject({ speaker: 'Rosa', text: 'Who left the gate open?' });
  });

  it('classifies sounds and music', () => {
    const cues = normalizeCues([
      raw('[door chime]', 1, 2),
      raw('(oven beeping)', 3, 4),
      raw('♪ radio playing ♪', 5, 6),
      raw('# la la la', 7, 8),
      raw('[sighs] Fine.', 9, 10),
    ]);
    expect(cues.map((c) => c.kind)).toEqual(['sound', 'sound', 'music', 'music', 'speech']);
  });

  it('drops empty and zero-length cues, sorts, merges identical neighbours and renumbers', () => {
    const cues = normalizeCues([
      raw('Third', 5, 6),
      raw('<i></i>', 2, 3),
      raw('Zero', 4, 4),
      raw('First', 1, 2),
      raw('First', 2.1, 2.8),
      raw('Again', 7, 8),
      raw('Again', 12, 13),
    ]);
    expect(cues.map((c) => [c.id, c.text, c.start, c.end])).toEqual([
      [1, 'First', 1, 2.8],
      [2, 'Third', 5, 6],
      [3, 'Again', 7, 8],
      [4, 'Again', 12, 13],
    ]);
  });

  it('allows overlapping cues', () => {
    const cues = normalizeCues([raw('A', 1, 5), raw('B', 2, 3)]);
    expect(cues).toHaveLength(2);
  });

  it('normalises the authored fixtures', () => {
    const fx = (n: string) => readFileSync(join(__dirname, '..', 'fixtures', n), 'utf8');
    const srt = normalizeCues(parseSrt(fx('sample.srt')));
    expect(srt.find((c) => c.text.includes('&'))?.text).toBe("A bar is a bar. I cleared it & I'm proud.");
    expect(srt.filter((c) => c.kind !== 'speech').map((c) => c.kind)).toEqual([
      'sound',
      'sound',
      'music',
      'sound',
    ]);
    const vtt = normalizeCues(parseVtt(fx('sample.vtt')));
    expect(vtt[5]!.lines).toEqual(['- Grab the bucket.', '- Which one?']);
    expect(vtt[6]!.text).toBe('The one with the carrots, genius.');
  });
});
