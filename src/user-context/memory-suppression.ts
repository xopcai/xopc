import { createHash } from 'node:crypto';
import type { DatabaseSync } from 'node:sqlite';

export function memoryFingerprint(parts: unknown[]): string {
  const normalized = parts.map((part) => typeof part === 'string'
    ? part.normalize('NFKC').toLowerCase().replace(/\s+/g, ' ').trim() : part);
  return createHash('sha256').update(JSON.stringify(normalized)).digest('hex');
}

export function isMemorySuppressed(db: DatabaseSync, fingerprints: string[]): boolean {
  return fingerprints.some((key) => db.prepare('SELECT 1 FROM memory_suppressions WHERE fingerprint = ?').get(key));
}

export function suppressMemory(db: DatabaseSync, fingerprints: string[], now: number): void {
  const insert = db.prepare('INSERT OR IGNORE INTO memory_suppressions (fingerprint, created_at) VALUES (?, ?)');
  for (const key of fingerprints) insert.run(key, now);
}

export function restoreMemory(db: DatabaseSync, fingerprints: string[]): void {
  for (const key of fingerprints) db.prepare('DELETE FROM memory_suppressions WHERE fingerprint = ?').run(key);
}

/** Remove cached decisions containing deleted content; retain only unrelated audit rows. */
export function clearMemoryAudit(db: DatabaseSync, type: 'assertion' | 'knowledge', id: string): void {
  db.prepare('DELETE FROM memory_maintenance_decisions WHERE object_type = ? AND object_id = ?').run(type, id);
  db.prepare('DELETE FROM execution_context_items WHERE object_type = ? AND object_id = ?').run(type, id);
}
