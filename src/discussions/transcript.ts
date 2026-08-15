import type { DiscussionTranscriptSegment } from './types.js';

export function appendTranscriptWithoutOverlap(existing: string, next: string): string {
  const left = existing.trim();
  const right = next.trim();
  if (!left) return right;
  if (!right) return left;
  const max = Math.min(200, left.length, right.length);
  for (let size = max; size >= 8; size -= 1) {
    if (left.slice(-size).toLocaleLowerCase() === right.slice(0, size).toLocaleLowerCase()) {
      return `${left}${right.slice(size)}`.trim();
    }
  }
  return `${left}\n${right}`;
}

export function assembleDiscussionTranscript(segments: DiscussionTranscriptSegment[]): string {
  return segments.reduce(
    (text, segment) => appendTranscriptWithoutOverlap(text, segment.transcript ?? ''),
    '',
  );
}
