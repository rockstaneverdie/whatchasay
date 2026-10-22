export const SUBTITLE_ENCODINGS = [
  'utf-8',
  'utf-16le',
  'utf-16be',
  'windows-1252',
  'windows-1251',
  'windows-1250',
] as const;

export type SubtitleEncoding = (typeof SUBTITLE_ENCODINGS)[number];

export interface DecodeResult {
  text: string;
  encoding: SubtitleEncoding;
  detectedBy: 'bom' | 'strict-utf8' | 'utf16-heuristic' | 'fallback' | 'manual';
}

function toBytes(input: ArrayBuffer | Uint8Array): Uint8Array {
  return input instanceof Uint8Array ? input : new Uint8Array(input);
}

function bomEncoding(b: Uint8Array): { encoding: SubtitleEncoding; length: number } | null {
  if (b.length >= 3 && b[0] === 0xef && b[1] === 0xbb && b[2] === 0xbf) {
    return { encoding: 'utf-8', length: 3 };
  }
  if (b.length >= 2 && b[0] === 0xff && b[1] === 0xfe) return { encoding: 'utf-16le', length: 2 };
  if (b.length >= 2 && b[0] === 0xfe && b[1] === 0xff) return { encoding: 'utf-16be', length: 2 };
  return null;
}

/** BOM-less UTF-16 of mostly-ASCII text has a zero byte in every other position. */
function guessUtf16(b: Uint8Array): SubtitleEncoding | null {
  const n = Math.min(b.length, 4096) & ~1;
  if (n < 8) return null;
  let evenZeros = 0;
  let oddZeros = 0;
  for (let i = 0; i < n; i += 2) {
    if (b[i] === 0) evenZeros++;
    if (b[i + 1] === 0) oddZeros++;
  }
  const half = n / 2;
  if (oddZeros / half > 0.3 && evenZeros / half < 0.05) return 'utf-16le';
  if (evenZeros / half > 0.3 && oddZeros / half < 0.05) return 'utf-16be';
  return null;
}

function decodeWith(b: Uint8Array, encoding: SubtitleEncoding): string {
  // ignoreBOM: we strip BOMs ourselves so the result never starts with U+FEFF.
  return new TextDecoder(encoding, { ignoreBOM: true }).decode(b);
}

/**
 * FR-S2: BOM detection (UTF-8 / UTF-16 LE/BE), strict UTF-8 attempt,
 * otherwise windows-1252. A manual choice overrides detection.
 */
export function decodeSubtitleBytes(
  input: ArrayBuffer | Uint8Array,
  forced?: SubtitleEncoding,
): DecodeResult {
  const bytes = toBytes(input);
  const bom = bomEncoding(bytes);

  if (forced) {
    const body = bom && bom.encoding === forced ? bytes.subarray(bom.length) : bytes;
    return { text: decodeWith(body, forced), encoding: forced, detectedBy: 'manual' };
  }
  if (bom) {
    return {
      text: decodeWith(bytes.subarray(bom.length), bom.encoding),
      encoding: bom.encoding,
      detectedBy: 'bom',
    };
  }
  const utf16 = guessUtf16(bytes);
  if (utf16) return { text: decodeWith(bytes, utf16), encoding: utf16, detectedBy: 'utf16-heuristic' };

  try {
    const text = new TextDecoder('utf-8', { fatal: true, ignoreBOM: true }).decode(bytes);
    return { text, encoding: 'utf-8', detectedBy: 'strict-utf8' };
  } catch {
    return { text: decodeWith(bytes, 'windows-1252'), encoding: 'windows-1252', detectedBy: 'fallback' };
  }
}
