import type { MessageContent } from '@/features/chat/messages/messages.types';

function splitPipeCells(line: string): string[] {
  return line
    .trim()
    .replace(/^\|/, '')
    .replace(/\|$/, '')
    .split('|')
    .map((cell) => cell.trim());
}

function pipeCount(line: string): number {
  return (line.match(/\|/g) ?? []).length;
}

function isLikelyPipeTableRow(line: string): boolean {
  const trimmed = line.trim();
  if (!trimmed) return false;
  return trimmed.startsWith('|') ? splitPipeCells(trimmed).length >= 2 : pipeCount(trimmed) >= 2;
}

function isSeparatorLike(line: string): boolean {
  const trimmed = line.trim();
  return trimmed.includes('-') && /^[\s|:-]+$/.test(trimmed);
}

function separatorColumnCount(line: string): number {
  return splitPipeCells(line).filter((cell) => cell.includes('-')).length;
}

function buildSeparator(columns: number): string {
  return `| ${Array.from({ length: columns }, () => '---').join(' | ')} |`;
}

function completePipeRow(line: string, columns: number): string {
  const cells = splitPipeCells(line);
  while (cells.length < columns) cells.push('');
  return `| ${cells.slice(0, columns).join(' | ')} |`;
}

function isInsideUnclosedFence(content: string): boolean {
  const fences = content.match(/^\s*(```|~~~)/gm) ?? [];
  return fences.length % 2 === 1;
}

/**
 * Make a still-streaming GFM pipe table parseable before the model has emitted
 * every trailing character. The returned text is render-only and must not be
 * persisted or copied back into the transcript.
 */
export function prepareStreamingMarkdown(content: string): string {
  if (!content.includes('|') || isInsideUnclosedFence(content)) return content;

  const lines = content.split('\n');
  let tailStart = lines.length - 1;
  while (tailStart > 0 && lines[tailStart - 1]?.trim()) {
    tailStart--;
  }

  const tail = lines.slice(tailStart);
  const tableStart = tail.findIndex((line) => isLikelyPipeTableRow(line));
  if (tableStart < 0) return content;

  const headerIndex = tailStart + tableStart;
  const header = lines[headerIndex] ?? '';
  const columns = splitPipeCells(header).length;
  if (columns < 2) return content;

  const separatorIndex = headerIndex + 1;
  const separator = lines[separatorIndex];
  if (separator === undefined || !separator.trim()) {
    return `${content}${content.endsWith('\n') ? '' : '\n'}${buildSeparator(columns)}`;
  }

  if (isSeparatorLike(separator) && separatorColumnCount(separator) < columns) {
    const next = [...lines];
    next[separatorIndex] = buildSeparator(columns);
    return next.join('\n');
  }

  if (!isSeparatorLike(separator)) return content;

  const lastIndex = lines.length - 1;
  const last = lines[lastIndex] ?? '';
  if (
    lastIndex > separatorIndex &&
    isLikelyPipeTableRow(last) &&
    !isSeparatorLike(last) &&
    !last.trim().endsWith('|')
  ) {
    const next = [...lines];
    next[lastIndex] = completePipeRow(last, columns);
    return next.join('\n');
  }

  return content;
}

/** Merge adjacent assistant text fragments so Markdown constructs can span SSE/UI chunks. */
export function mergeConsecutiveTextBlocks(content: MessageContent[]): MessageContent[] {
  const out: MessageContent[] = [];
  for (const block of content) {
    const previous = out[out.length - 1];
    if (block.type === 'text' && previous?.type === 'text') {
      previous.text = `${previous.text ?? ''}${block.text ?? ''}`;
      continue;
    }
    out.push({ ...block });
  }
  return out;
}
