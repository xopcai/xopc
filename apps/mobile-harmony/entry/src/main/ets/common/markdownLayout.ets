import { internalMessageLink } from './messageLink';
import { markdownSpans, XopcMarkdownBlock, XopcMarkdownSpan, XopcMarkdownTableRow } from './markdown';

const compactTableValue = /^[+−-]?(?:[$€£¥￥]\s?|v)?[0-9]+(?:[.,:/\u00a0\u202f-][0-9]+)*(?:\s?(?:[%％‰]|[$€£¥￥]|ms|s|KB|MB|GB|TB))?$/i;
export const MARKDOWN_TABLE_CELL_INSET: number = 6;

export function markdownTableWidths(rows: XopcMarkdownTableRow[], available: number,
  measureText: (text: string, strong: boolean) => number): number[] {
  const count = rows[0]?.cells.length ?? 0;
  const minimum: number[] = [];
  const preferred: number[] = [];
  for (let column = 0; column < count; column++) {
    minimum.push(0);
    preferred.push(0);
  }
  for (const row of rows) {
    for (let column = 0; column < row.cells.length && column < count; column++) {
      const spans = markdownSpans(row.cells[column].text);
      const text = spans.map((span: XopcMarkdownSpan): string => span.text).join('');
      const strong = row.header || spans.some((span: XopcMarkdownSpan): boolean => span.kind === 'bold');
      const width = Math.max(28, Math.ceil(measureText(text.slice(0, 64), strong)) + 2 * MARKDOWN_TABLE_CELL_INSET + 1);
      const compact = !row.header && text.length <= 16 && compactTableValue.test(text);
      minimum[column] = Math.max(minimum[column], compact ? width : Math.min(width, 64));
      preferred[column] = Math.max(preferred[column], compact ? width : Math.min(width, 320));
    }
  }
  const minTotal = minimum.reduce((total: number, width: number): number => total + width, 0);
  const preferredTotal = preferred.reduce((total: number, width: number): number => total + width, 0);
  const extra = preferredTotal - minTotal;
  const fraction = extra > 0 ? Math.min(1, Math.max(0, (available - minTotal) / extra)) : 0;
  return minimum.map((width: number, column: number): number =>
    width + Math.floor((preferred[column] - width) * fraction));
}

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
