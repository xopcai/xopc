import { mathRanges } from '@xopcai/markdown-math/remark';
import { parseMarkdownIntoBlocks } from 'streamdown';

export function parseChatMarkdownBlocks(markdown: string): string[] {
  if (/^\s{0,3}\[[^\]]+\]:|\[[^\]]+\]\[[^\]]*\]|\[\^/m.test(markdown)) return [markdown];
  const blocks = parseMarkdownIntoBlocks(markdown);
  const ranges = mathRanges(markdown);
  if (!ranges.length) return blocks;
  if (blocks.join('') !== markdown) return [markdown];
  const merged: string[] = [];
  let end = 0; let pending = '';
  for (const block of blocks) {
    pending += block; end += block.length;
    if (!ranges.some(range => range.start < end && range.end > end)) {
      merged.push(pending); pending = '';
    }
  }
  if (pending) merged.push(pending);
  return merged;
}

/** Reparse only the last two unstable blocks when the source is appended. */
export function createChatBlockParser(): (markdown: string) => string[] {
  let previous = ''; let blocks: string[] = [];
  return markdown => {
    if (markdown === previous) return blocks;
    const head = markdown.startsWith(previous) && !/\[\^|\]\[/m.test(markdown) ? blocks.slice(0, -2) : [];
    const offset = head.reduce((sum, block) => sum + block.length, 0);
    blocks = [...head, ...parseChatMarkdownBlocks(markdown.slice(offset))];
    previous = markdown;
    return blocks;
  };
}
