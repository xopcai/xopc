export type EvidenceRange = { start: number; end: number };

/** Offsets are Unicode code points into a persisted successful tool result, never the input command. */
export function observedEvidenceExcerpt(body: string, range: EvidenceRange): string {
  const points = Array.from(body);
  if (!Number.isInteger(range.start) || !Number.isInteger(range.end) || range.start < 0
    || range.end <= range.start || range.end > points.length || range.end - range.start > 1000) {
    throw new Error('Evidence range must select 1..1000 observed Unicode characters within the successful read');
  }
  return points.slice(range.start, range.end).join('');
}

export function suggestedEvidenceRanges(body: string): EvidenceRange[] {
  const length = Array.from(body).length;
  if (!length) return [];
  return [{ start: 0, end: Math.min(1000, length) },
    ...(length > 1000 ? [{ start: Math.max(1000, length - 1000), end: length }] : [])];
}
