/**
 * Truncate text at a sentence or word boundary (TTS-friendly).
 */
export function truncateAtSentenceBoundary(text: string, maxLength: number): string {
  if (text.length <= maxLength) return text;

  const truncated = text.slice(0, maxLength);
  const sentenceEndRegex = /[.!?。！？]\s*/g;
  let lastSentenceEnd = -1;
  let match: RegExpExecArray | null;

  while ((match = sentenceEndRegex.exec(truncated)) !== null) {
    lastSentenceEnd = match.index + match[0].length;
  }

  if (lastSentenceEnd > maxLength * 0.6) {
    return truncated.slice(0, lastSentenceEnd).trim();
  }

  const lastSpace = truncated.lastIndexOf(' ');
  if (lastSpace > maxLength * 0.8) {
    return `${truncated.slice(0, lastSpace).trim()}...`;
  }

  return `${truncated.trim()}...`;
}
