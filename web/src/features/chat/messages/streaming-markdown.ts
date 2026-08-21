import type { MessageContent } from '@/features/chat/messages/messages.types';

function tableLinePrefix(line: string): string {
  const withoutCr = line.replace(/\r$/, '');
  let prefix = '';
  let rest = withoutCr;

  const leading = rest.match(/^\s{0,3}/)?.[0] ?? '';
  prefix += leading;
  rest = rest.slice(leading.length);

  while (rest.startsWith('>')) {
    prefix += '>';
    rest = rest.slice(1);
    if (rest.startsWith(' ')) {
      prefix += ' ';
      rest = rest.slice(1);
    }
    const nestedLeading = rest.match(/^\s{0,3}/)?.[0] ?? '';
    prefix += nestedLeading;
    rest = rest.slice(nestedLeading.length);
  }

  return prefix;
}

function tableLineBody(line: string): string {
  const withoutCr = line.replace(/\r$/, '');
  return withoutCr.slice(tableLinePrefix(withoutCr).length);
}

function splitPipeCells(line: string): string[] {
  return tableLineBody(line)
    .trim()
    .replace(/^\|/, '')
    .replace(/\|$/, '')
    .split('|')
    .map((cell) => cell.trim());
}

function pipeCount(line: string): number {
  return (tableLineBody(line).match(/\|/g) ?? []).length;
}

function isLikelyPipeTableRow(line: string): boolean {
  const body = tableLineBody(line).trim();
  if (!body) return false;
  return body.startsWith('|') ? splitPipeCells(line).length >= 2 : pipeCount(line) >= 2;
}

function isSeparatorLike(line: string): boolean {
  const body = tableLineBody(line).trim();
  return body.includes('-') && /^[\s|:-]+$/.test(body);
}

function isStreamingSeparatorPrefix(line: string): boolean {
  const body = tableLineBody(line).trim();
  return body.length > 0 && /^[\s|:]+$/.test(body);
}

function separatorColumnCount(line: string): number {
  return splitPipeCells(line).filter((cell) => cell.includes('-')).length;
}

function buildSeparator(columns: number, prefix = ''): string {
  return `${prefix}| ${Array.from({ length: columns }, () => '---').join(' | ')} |`;
}

function completePipeRow(line: string, columns: number): string {
  const cells = splitPipeCells(line);
  while (cells.length < columns) cells.push('');
  return `${tableLinePrefix(line)}| ${cells.slice(0, columns).join(' | ')} |`;
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
  const tablePrefix = tableLinePrefix(header);

  const separatorIndex = headerIndex + 1;
  const separator = lines[separatorIndex];
  if (separator === undefined) {
    return `${content}${content.endsWith('\n') ? '' : '\n'}${buildSeparator(columns, tablePrefix)}`;
  }

  if (!tableLineBody(separator).trim()) {
    const next = [...lines];
    next[separatorIndex] = buildSeparator(columns, tablePrefix);
    return next.join('\n');
  }

  if (
    (isSeparatorLike(separator) && separatorColumnCount(separator) < columns) ||
    isStreamingSeparatorPrefix(separator)
  ) {
    const next = [...lines];
    next[separatorIndex] = buildSeparator(columns, tablePrefix);
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

/** Merge adjacent assistant text fragments so Markdown constructs can span realtime/UI chunks. */
export function mergeConsecutiveTextBlocks(content: MessageContent[]): MessageContent[] {
  const out: MessageContent[] = [];
  for (const block of content) {
    const previous = out[out.length - 1];
    if (
      block.type === 'text'
      && previous?.type === 'text'
      && block.segmentId === previous.segmentId
      && block.presentation === previous.presentation
    ) {
      previous.text = `${previous.text ?? ''}${block.text ?? ''}`;
      continue;
    }
    out.push({ ...block });
  }
  return out;
}
