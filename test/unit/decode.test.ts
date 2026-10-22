import { describe, expect, it } from 'vitest';
import { decodeSubtitleBytes } from '../../src/core/subtitles/decode';

const utf8 = (s: string) => new TextEncoder().encode(s);

function utf16(s: string, le: boolean, bom: boolean): Uint8Array {
  const out: number[] = bom ? (le ? [0xff, 0xfe] : [0xfe, 0xff]) : [];
  for (let i = 0; i < s.length; i++) {
    const c = s.charCodeAt(i);
    if (le) out.push(c & 0xff, c >> 8);
    else out.push(c >> 8, c & 0xff);
  }
  return new Uint8Array(out);
}

describe('decodeSubtitleBytes', () => {
  it('strips a UTF-8 BOM', () => {
    const r = decodeSubtitleBytes(new Uint8Array([0xef, 0xbb, 0xbf, ...utf8('Ça va')]));
    expect(r).toMatchObject({ text: 'Ça va', encoding: 'utf-8', detectedBy: 'bom' });
  });

  it('detects UTF-16 LE and BE by BOM', () => {
    expect(decodeSubtitleBytes(utf16('Hi “there”', true, true))).toMatchObject({
      text: 'Hi “there”',
      encoding: 'utf-16le',
    });
    expect(decodeSubtitleBytes(utf16('Hi there', false, true))).toMatchObject({
      text: 'Hi there',
      encoding: 'utf-16be',
    });
  });

  it('guesses BOM-less UTF-16 from zero bytes', () => {
    const r = decodeSubtitleBytes(utf16('1\n00:00:01,000 --> 00:00:02,000\nHello\n', true, false));
    expect(r.encoding).toBe('utf-16le');
    expect(r.text).toContain('Hello');
  });

  it('accepts valid UTF-8 without BOM', () => {
    expect(decodeSubtitleBytes(utf8('naïve café'))).toMatchObject({
      text: 'naïve café',
      encoding: 'utf-8',
      detectedBy: 'strict-utf8',
    });
  });

  it('falls back to windows-1252 for invalid UTF-8', () => {
    // "café “quoted”" in cp1252: é = E9, “ = 93, ” = 94
    const bytes = new Uint8Array([0x63, 0x61, 0x66, 0xe9, 0x20, 0x93, 0x71, 0x94]);
    expect(decodeSubtitleBytes(bytes)).toMatchObject({
      text: 'café “q”',
      encoding: 'windows-1252',
      detectedBy: 'fallback',
    });
  });

  it('honours a manual encoding', () => {
    // "Привет" in windows-1251
    const bytes = new Uint8Array([0xcf, 0xf0, 0xe8, 0xe2, 0xe5, 0xf2]);
    expect(decodeSubtitleBytes(bytes, 'windows-1251').text).toBe('Привет');
  });
});
