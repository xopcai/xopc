import { markdownSpans, XopcMarkdownBlock, XopcMarkdownSpan } from './markdown';

export function markdownBlockGap(block: XopcMarkdownBlock, previous?: XopcMarkdownBlock): number {
  if (!previous) return 0;
  return block.kind === 'list' && previous.kind === 'list' ? 3 : 8;
}

export function markdownEstimatedLines(block: XopcMarkdownBlock): number {
  const text = markdownSpans(block.text).map((span: XopcMarkdownSpan): string => span.text).join('');
  const capacity = Math.max(8, 15 - (block.kind === 'list' ? Math.min(block.level, 6) : 0));
  let lines = 0;
  for (const line of text.split('\n')) {
    let units = 0;
    for (let index = 0; index < line.length; index++) units += line.charCodeAt(index) > 255 ? 1 : 0.55;
    lines += Math.max(1, Math.ceil(units / capacity));
  }
  return lines;
}

export function markdownPreviewBlocks(blocks: XopcMarkdownBlock[], lineLimit: number): XopcMarkdownBlock[] {
  const result: XopcMarkdownBlock[] = [];
  let remaining = lineLimit;
  for (const block of blocks) {
    if (block.kind === 'image' || block.kind === 'rule' || !block.text) continue;
    if (remaining <= 0) break;
    result.push(block);
    remaining -= markdownEstimatedLines(block);
  }
  return result;
}

export function markdownPreviewBlockLines(blocks: XopcMarkdownBlock[], index: number, lineLimit: number): number {
  let remaining = lineLimit;
  for (let position = 0; position < index; position++) remaining -= markdownEstimatedLines(blocks[position]);
  return Math.max(1, Math.min(remaining, markdownEstimatedLines(blocks[index])));
}
