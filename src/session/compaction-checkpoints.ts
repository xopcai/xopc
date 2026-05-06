/**
 * Pre-compaction transcript snapshots ({safeKey}.compaction-backup.{uuid}.json).
 * OpenClaw-style listing and id normalization for gateway APIs.
 */

const UUID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

/**
 * Accept raw uuid or full backup filename stem; returns lowercase uuid or null.
 */
export function normalizeCompactionCheckpointId(raw: string): string | null {
  const t = raw.trim();
  if (!t) return null;
  if (UUID_RE.test(t)) {
    return t.toLowerCase();
  }
  const m = t.match(/\.compaction-backup\.([0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12})\.json$/i);
  if (m?.[1] && UUID_RE.test(m[1])) {
    return m[1].toLowerCase();
  }
  return null;
}
