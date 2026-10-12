const wordSegmenter = typeof Intl.Segmenter === 'function' ? new Intl.Segmenter(undefined, { granularity: 'word' }) : null;
const graphemeSegmenter = typeof Intl.Segmenter === 'function' ? new Intl.Segmenter(undefined, { granularity: 'grapheme' }) : null;

export function splitRevealText(text: string): { text: string; offset: number }[] {
  return wordSegmenter ? Array.from(wordSegmenter.segment(text), ({ segment, index }) => ({ text: segment, offset: index }))
    : [{ text, offset: 0 }];
}

export function graphemeCommitBoundary(text: string, offset: number): number {
  if (offset >= text.length) return text.length;
  if (!graphemeSegmenter) return text.length;
  const segment = graphemeSegmenter.segment(text).containing(offset);
  return segment && segment.index !== offset ? segment.index + segment.segment.length : offset;
}
