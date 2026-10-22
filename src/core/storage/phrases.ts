import { getDb, type SavedPhrase } from './idb';

export async function addPhrase(p: Omit<SavedPhrase, 'id' | 'createdAt'>): Promise<number> {
  return (await getDb()).add('phrases', { ...p, createdAt: Date.now() });
}

export async function listPhrases(): Promise<SavedPhrase[]> {
  return (await (await getDb()).getAllFromIndex('phrases', 'byCreatedAt')).reverse();
}

export async function deletePhrase(id: number): Promise<void> {
  await (await getDb()).delete('phrases', id);
}

const csvCell = (s: string) => `"${s.replaceAll('"', '""')}"`;

/** FR-W1: Anki-friendly CSV — Front = phrase in context, Back = explanation. */
export function phrasesToCsv(items: SavedPhrase[]): string {
  const rows = [['Front', 'Back', 'Show', 'Time', 'Type'].map(csvCell).join(',')];
  for (const p of items) {
    const front =
      p.cueText.includes(p.phrase) && p.phrase !== p.cueText
        ? `${p.cueText.replace(p.phrase, `<b>${p.phrase}</b>`)}`
        : p.cueText || p.phrase;
    const mins = Math.floor(p.time / 60);
    const secs = String(Math.floor(p.time % 60)).padStart(2, '0');
    rows.push([front, p.explanation, p.show, `${mins}:${secs}`, p.type].map(csvCell).join(','));
  }
  // BOM so spreadsheet apps detect UTF-8 (Cyrillic explanations).
  return '\uFEFF' + rows.join('\r\n') + '\r\n';
}
