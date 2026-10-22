import type { ExplainResult } from '../ai/types';
import { getDb, type CachedExplanation } from './idb';

/** FR-K2: a hit, unless 👎 marked it as bad (FR-K3). */
export async function getCached(key: string): Promise<CachedExplanation | null> {
  const db = await getDb();
  const rec = await db.get('explanations', key);
  if (!rec || rec.bad) return null;
  rec.lastAccess = Date.now();
  await db.put('explanations', rec);
  return rec;
}

/** Only complete answers are stored (FR-I5: partial text is never cached). */
export async function putCached(
  key: string,
  result: ExplainResult,
  model: string,
  maxBytes: number,
): Promise<void> {
  const db = await getDb();
  const now = Date.now();
  const rec: CachedExplanation = {
    key,
    text: result.text,
    type: result.type,
    confidence: result.confidence,
    ...(result.expr ? { expr: result.expr } : {}),
    model,
    createdAt: now,
    lastAccess: now,
    size: 0,
  };
  rec.size = JSON.stringify(rec).length * 2;
  await db.put('explanations', rec);
  await pruneCache(maxBytes);
}

export async function markBad(key: string): Promise<void> {
  const db = await getDb();
  const rec = await db.get('explanations', key);
  if (rec) await db.put('explanations', { ...rec, bad: true });
}

/** FR-K4: least recently used entries go first once the total exceeds the limit. */
export async function pruneCache(maxBytes: number): Promise<number> {
  const db = await getDb();
  const all = await db.getAllFromIndex('explanations', 'byLastAccess');
  let total = all.reduce((n, r) => n + r.size, 0);
  let removed = 0;
  const tx = db.transaction('explanations', 'readwrite');
  for (const rec of all) {
    if (total <= maxBytes) break;
    await tx.store.delete(rec.key);
    total -= rec.size;
    removed++;
  }
  await tx.done;
  return removed;
}

export async function cacheStats(): Promise<{ entries: number; bytes: number }> {
  const all = await (await getDb()).getAll('explanations');
  return { entries: all.length, bytes: all.reduce((n, r) => n + r.size, 0) };
}

export async function clearCache(): Promise<void> {
  await (await getDb()).clear('explanations');
}

export async function exportCache(): Promise<CachedExplanation[]> {
  return (await getDb()).getAll('explanations');
}

export async function importCache(records: unknown, maxBytes: number): Promise<number> {
  if (!Array.isArray(records)) throw new Error('expected an array');
  const db = await getDb();
  let n = 0;
  for (const r of records as Partial<CachedExplanation>[]) {
    if (typeof r?.key !== 'string' || typeof r.text !== 'string') continue;
    const rec: CachedExplanation = {
      key: r.key,
      text: r.text,
      type: r.type ?? 'other',
      confidence: r.confidence ?? 'medium',
      ...(r.expr ? { expr: r.expr } : {}),
      model: r.model ?? 'imported',
      createdAt: r.createdAt ?? Date.now(),
      lastAccess: Date.now(),
      size: JSON.stringify(r).length * 2,
      ...(r.bad ? { bad: true } : {}),
    };
    await db.put('explanations', rec);
    n++;
  }
  await pruneCache(maxBytes);
  return n;
}
