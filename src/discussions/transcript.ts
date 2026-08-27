import type { DiscussionTranscriptSegment } from './types.js';

function searchableCharacters(value: string): { text: string; sourceEnds: number[] } {
  let text = '';
  const sourceEnds: number[] = [];
  let sourceOffset = 0;
  for (const character of value) {
    sourceOffset += character.length;
    if (!/[\p{L}\p{N}]/u.test(character)) continue;
    text += character.toLocaleLowerCase();
    sourceEnds.push(sourceOffset);
  }
  return { text, sourceEnds };
}

function joinOverlap(left: string, remainder: string): string {
  const next = /[\p{P}\p{S}]$/u.test(left)
    ? remainder.replace(/^[\s\p{P}\p{S}]+/u, '')
    : remainder;
  return `${left}${next}`.trim();
}

export function appendTranscriptWithoutOverlap(existing: string, next: string): string {
  const left = existing.trim();
  const right = next.trim();
  if (!left) return right;
  if (!right) return left;
  const max = Math.min(200, left.length, right.length);
  for (let size = max; size >= 8; size -= 1) {
    if (left.slice(-size).toLocaleLowerCase() === right.slice(0, size).toLocaleLowerCase()) {
      return joinOverlap(left, right.slice(size));
    }
  }

  const leftSearchable = searchableCharacters(left).text.slice(-200);
  const rightSearchable = searchableCharacters(right);
  const normalizedMax = Math.min(leftSearchable.length, rightSearchable.text.length);
  for (let size = normalizedMax; size >= 5; size -= 1) {
    if (leftSearchable.slice(-size) !== rightSearchable.text.slice(0, size)) continue;
    const sourceEnd = rightSearchable.sourceEnds[size - 1];
    return joinOverlap(left, right.slice(sourceEnd));
  }
  return `${left}\n${right}`;
}

export function assembleDiscussionTranscript(segments: DiscussionTranscriptSegment[]): string {
  return segments.reduce(
    (text, segment) => appendTranscriptWithoutOverlap(text, segment.displayText ?? ''),
    '',
  );
}
