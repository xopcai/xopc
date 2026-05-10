/**
 * Dedupe-merge sender ids into an allowFrom list (config JSON uses string | number).
 */
export function mergeDistinctSenderIds(
  existingAllowFrom: unknown,
  extraIds: ReadonlyArray<string | undefined | null>,
): Array<string | number> {
  const prev = Array.isArray(existingAllowFrom)
    ? (existingAllowFrom as Array<string | number>).map((x) => String(x).trim())
    : [];
  const set = new Set(prev.filter(Boolean));
  for (const id of extraIds) {
    const t = typeof id === 'string' ? id.trim() : '';
    if (t) set.add(t);
  }
  return [...set];
}
