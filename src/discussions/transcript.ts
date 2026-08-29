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
  const next = /\p{P}$/u.test(left) ? remainder.replace(/^\p{P}+/u, '') : remainder;
  if (!next || /^\s/u.test(next)) return `${left}${next}`.trim();

  const leftCharacter = Array.from(left).findLast((character) => /[\p{L}\p{N}\p{S}]/u.test(character));
  const rightCharacter = Array.from(next).find((character) => /[\p{L}\p{N}\p{S}]/u.test(character));
  const compactScript = /[\p{Script=Han}\p{Script=Hiragana}\p{Script=Katakana}\p{Script=Hangul}]/u;
  const separator = leftCharacter
    && rightCharacter
    && !compactScript.test(leftCharacter)
    && !compactScript.test(rightCharacter)
    ? ' '
    : '';
  return `${left}${separator}${next}`.trim();
}

/** Joins transcripts from adjacent audio chunks that have no audio overlap. */
export function appendSequentialTranscript(existing: string, next: string): string {
  const left = existing.trim();
  const right = next.trim();
  if (!left) return right;
  if (!right) return left;
  return `${left}\n${right}`;
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
  return appendSequentialTranscript(left, right);
}

export function assembleDiscussionTranscript(segments: DiscussionTranscriptSegment[]): string {
  return segments.reduce(
    (text, segment) => appendTranscriptWithoutOverlap(text, segment.displayText ?? ''),
    '',
  );
}
