import { internalMessageLink } from './messageLink';
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

/** Collapse only an adjacent generic view link to the exact same image. */
export function markdownReadingBlocks(blocks: XopcMarkdownBlock[]): XopcMarkdownBlock[] {
  return blocks.filter((block: XopcMarkdownBlock, index: number): boolean => {
    const next = blocks[index + 1];
    if (block.kind !== 'paragraph' || next?.kind !== 'image') return true;
    const spans = markdownSpans(block.text);
    if (spans.length !== 1 || spans[0].kind !== 'link'
      || !/^(查看(?:高清|原|大)?图片|查看大图|查看原图|view(?: (?:full[- ]size|original|hd))? image)$/i.test(spans[0].text)) return true;
    const left = internalMessageLink(spans[0].href || '')?.path || spans[0].href;
    const right = internalMessageLink(next.href || '')?.path || next.href;
    return left !== right;
  });
}
