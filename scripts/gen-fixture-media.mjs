// Generates test fixtures that should not live in git:
//   test/fixtures/media/tone.wav   – 60 s, soft tone pulses during every cue of sample.srt
//   test/fixtures/media/long.wav   – 25 min, quiet ticks (for the 1 000-cue performance check)
//   test/fixtures/media/long.srt   – 1 000 procedurally generated (invented) cues
// No video codec is needed: Firefox plays WAV inside <video>, which is all the overlay needs.
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..', 'test', 'fixtures');
const out = join(root, 'media');
mkdirSync(out, { recursive: true });

function writeWav(path, seconds, rate, sample) {
  const n = Math.round(seconds * rate);
  const buf = Buffer.alloc(44 + n);
  buf.write('RIFF', 0);
  buf.writeUInt32LE(36 + n, 4);
  buf.write('WAVE', 8);
  buf.write('fmt ', 12);
  buf.writeUInt32LE(16, 16);
  buf.writeUInt16LE(1, 20); // PCM
  buf.writeUInt16LE(1, 22); // mono
  buf.writeUInt32LE(rate, 24);
  buf.writeUInt32LE(rate, 28); // byte rate (8-bit mono)
  buf.writeUInt16LE(1, 32);
  buf.writeUInt16LE(8, 34);
  buf.write('data', 36);
  buf.writeUInt32LE(n, 40);
  for (let i = 0; i < n; i++) {
    const v = Math.max(-1, Math.min(1, sample(i / rate)));
    buf[44 + i] = Math.round(128 + v * 100);
  }
  writeFileSync(path, buf);
}

const ts = (s) => {
  const [clock, frac = '0'] = s.split(/[.,]/);
  return clock.split(':').reduce((a, p) => a * 60 + Number(p), 0) + Number(frac) / 10 ** frac.length;
};

const srt = readFileSync(join(root, 'sample.srt'), 'utf8');
const cues = [...srt.matchAll(/(\d+:\d+:\d+[,.]\d+)\s*-->\s*(\d+:\d+:\d+[,.]\d+)/g)].map((m) => [
  ts(m[1]),
  ts(m[2]),
]);

writeWav(join(out, 'tone.wav'), 60, 8000, (t) => {
  const cue = cues.find(([a, b]) => t >= a && t < b);
  if (!cue) return 0;
  // ~4 "syllables" per second so the word highlight can be compared by ear.
  const env = Math.sin(Math.PI * (((t - cue[0]) * 4) % 1)) ** 2;
  return 0.25 * env * Math.sin(2 * Math.PI * 330 * t);
});

const LONG_SECONDS = 25 * 60;
writeWav(join(out, 'long.wav'), LONG_SECONDS, 2000, (t) => (t % 1 < 0.02 ? 0.2 : 0));

const subjects = [
  'The kettle',
  'My neighbour',
  'This map',
  'Our van',
  'The parrot',
  'Your cousin',
  'That song',
];
const verbs = [
  'is acting up',
  'went missing',
  'needs a nap',
  'keeps humming',
  'won the raffle',
  'smells of toast',
];
const tails = [
  'again.',
  'for some reason.',
  'before lunch.',
  'apparently.',
  'and nobody noticed.',
  'right on cue!',
];
let long = '';
for (let i = 0; i < 1000; i++) {
  const start = 1 + i * 1.45;
  const end = start + 1.2;
  const f = (s) => {
    const h = Math.floor(s / 3600);
    const m = Math.floor((s % 3600) / 60);
    const sec = Math.floor(s % 60);
    const ms = Math.round((s % 1) * 1000);
    return `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}:${String(sec).padStart(2, '0')},${String(ms).padStart(3, '0')}`;
  };
  const line = `${subjects[i % 7]} ${verbs[(i * 3) % 6]} ${tails[(i * 5) % 6]}`;
  long += `${i + 1}\n${f(start)} --> ${f(end)}\n${i % 2 ? 'KIT' : 'LEO'}: ${line}\n\n`;
}
writeFileSync(join(out, 'long.srt'), long);

console.log(`fixtures written to ${out}`);
