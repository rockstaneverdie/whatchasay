import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import {
  detectFormat,
  parseSrt,
  parseSubtitles,
  parseTimestamp,
  parseVtt,
  SubtitleParseError,
} from '../../src/core/subtitles/parse';

const fixture = (name: string) => readFileSync(join(__dirname, '..', 'fixtures', name), 'utf8');

describe('parseTimestamp', () => {
  it.each([
    ['00:00:01,000', 1],
    ['00:00:01.250', 1.25],
    ['01:02:03,456', 3723.456],
    ['02:03.5', 123.5],
    ['00:00:07,5', 7.5],
    ['1:00:00', 3600],
  ])('%s → %f', (s, v) => {
    expect(parseTimestamp(s)).toBeCloseTo(v, 6);
  });
});

describe('parseSrt', () => {
  it('parses a regular file with CRLF', () => {
    const cues = parseSrt(
      '1\r\n00:00:01,000 --> 00:00:02,500\r\nHello\r\nthere\r\n\r\n2\r\n00:00:03,000 --> 00:00:04,000\r\nBye\r\n',
    );
    expect(cues).toEqual([
      { start: 1, end: 2.5, text: 'Hello\nthere' },
      { start: 3, end: 4, text: 'Bye' },
    ]);
  });

  it('handles dot milliseconds, missing blank lines and missing numbers', () => {
    const cues = parseSrt(
      [
        '1',
        '00:00:01.000 --> 00:00:02.000',
        'One',
        '2',
        '00:00:03,000 --> 00:00:04,000',
        'Two',
        '00:00:05,000 --> 00:00:06,000',
        'Three',
      ].join('\n'),
    );
    expect(cues.map((c) => c.text)).toEqual(['One', 'Two', 'Three']);
  });

  it('keeps text after a blank line inside a cue', () => {
    const cues = parseSrt(
      '1\n00:00:01,000 --> 00:00:02,000\nFirst\n\nstill first\n\n2\n00:00:03,000 --> 00:00:04,000\nSecond\n',
    );
    expect(cues.map((c) => c.text)).toEqual(['First\nstill first', 'Second']);
  });

  it('tolerates leading junk, many blank lines and trailing whitespace', () => {
    const cues = parseSrt(
      '\n\n\n1  \n00:00:01,000 --> 00:00:02,000   X1:10\nA\n\n\n\n\n2\n00:00:03,000-->00:00:04,000\nB\n\n\n',
    );
    expect(cues).toHaveLength(2);
    expect(cues[1]).toMatchObject({ start: 3, end: 4, text: 'B' });
  });

  it('parses the authored fixture, including a cue without a separating blank line', () => {
    const cues = parseSrt(fixture('sample.srt'));
    expect(cues).toHaveLength(29);
    expect(cues[25]!.text).toBe('MAYA: And yet here you are,\neating it up.');
    expect(cues[26]!.start).toBeCloseTo(97.4);
  });
});

describe('parseVtt', () => {
  it('skips header, NOTE and STYLE blocks and reads identifiers and settings', () => {
    const cues = parseVtt(fixture('sample.vtt'));
    expect(cues[0]).toEqual({ start: 1, end: 3.5, text: '[wind chimes]' });
    expect(cues.some((c) => c.text.includes('Invented dialogue'))).toBe(false);
    expect(cues.some((c) => c.text.includes('::cue'))).toBe(false);
    expect(cues).toHaveLength(9);
    expect(cues[3]!.text).toBe("<v Rosa>That's what I'm afraid of.\nThe goats are <i>loose</i> again.");
  });

  it('accepts timestamps without hours', () => {
    expect(parseVtt('WEBVTT\n\n00:01.000 --> 00:02.000\nHi\n')).toEqual([{ start: 1, end: 2, text: 'Hi' }]);
  });
});

describe('parseSubtitles', () => {
  it('detects the format', () => {
    expect(detectFormat('WEBVTT\n\n')).toBe('vtt');
    expect(detectFormat('\uFEFFWEBVTT')).toBe('vtt');
    expect(detectFormat('1\n00:00:01,000 --> ...', 'x.vtt')).toBe('vtt');
    expect(detectFormat('1\n00:00:01,000 --> ...', 'x.srt')).toBe('srt');
  });

  it('throws on a file without cues', () => {
    expect(() => parseSubtitles('just some text')).toThrow(SubtitleParseError);
  });
});
