import { getThemeExports } from './theme-manager.js';

const DIFF_TOOLS = new Set([
  'edit',
  'write',
  'apply_patch',
  'patch',
  'search_replace',
  'str_replace',
]);

export function isDiffFriendlyTool(toolName: string): boolean {
  const base = toolName.split('__').pop()?.toLowerCase() ?? toolName.toLowerCase();
  return DIFF_TOOLS.has(base);
}

export function looksLikeUnifiedDiff(text: string): boolean {
  const sample = text.trimStart();
  if (sample.startsWith('@@')) return true;
  const lines = sample.split('\n').slice(0, 20);
  let diffLines = 0;
  for (const line of lines) {
    if (/^(\+\+\+|---|@@|[+-] |diff --git)/.test(line)) diffLines += 1;
  }
  return diffLines >= 2;
}

/** Colorize unified diff lines for terminal display. */
export function renderUnifiedDiff(text: string, maxLines = 80): string {
  const palette = getThemeExports().palette;
  const fg = (hex: string) => (line: string) => `\x1b[38;2;${hexToRgb(hex)}m${line}\x1b[0m`;
  const added = fg(palette.success);
  const removed = fg(palette.error);
  const context = fg(palette.dim);
  const header = fg(palette.accentSoft);
  const inverse = (value: string) => `\x1b[7m${value}\x1b[27m`;

  const lines = text.split('\n');
  const capped = lines.length > maxLines ? [...lines.slice(0, maxLines), '…'] : lines;

  const rendered: string[] = [];
  for (let index = 0; index < capped.length; index += 1) {
    const line = capped[index] ?? '';
    const next = capped[index + 1] ?? '';

    if (isRemovedDiffLine(line) && isAddedDiffLine(next)) {
      const pair = renderReplacementPair(line, next, inverse);
      rendered.push(removed(pair.removedLine));
      rendered.push(added(pair.addedLine));
      index += 1;
      continue;
    }

    if (isDiffHeaderLine(line)) {
      rendered.push(header(line));
    } else if (line.startsWith('+')) {
      rendered.push(added(replaceTabs(line)));
    } else if (line.startsWith('-')) {
      rendered.push(removed(replaceTabs(line)));
    } else {
      rendered.push(context(replaceTabs(line)));
    }
  }

  return rendered.join('\n');
}

function isDiffHeaderLine(line: string): boolean {
  return line.startsWith('+++') || line.startsWith('---') || line.startsWith('@@') || line.startsWith('diff --git');
}

function isRemovedDiffLine(line: string): boolean {
  return line.startsWith('-') && !line.startsWith('---');
}

function isAddedDiffLine(line: string): boolean {
  return line.startsWith('+') && !line.startsWith('+++');
}

function replaceTabs(text: string): string {
  return text.replace(/\t/g, '   ');
}

function renderReplacementPair(
  removedLine: string,
  addedLine: string,
  inverse: (value: string) => string,
): { removedLine: string; addedLine: string } {
  const removedContent = replaceTabs(removedLine.slice(1));
  const addedContent = replaceTabs(addedLine.slice(1));
  const commonPrefix = commonPrefixLength(removedContent, addedContent);
  const commonSuffix = commonSuffixLength(
    removedContent.slice(commonPrefix),
    addedContent.slice(commonPrefix),
  );

  const removedChangedEnd = removedContent.length - commonSuffix;
  const addedChangedEnd = addedContent.length - commonSuffix;
  return {
    removedLine: `-${highlightChangedSpan(removedContent, commonPrefix, removedChangedEnd, inverse)}`,
    addedLine: `+${highlightChangedSpan(addedContent, commonPrefix, addedChangedEnd, inverse)}`,
  };
}

function highlightChangedSpan(
  text: string,
  start: number,
  end: number,
  inverse: (value: string) => string,
): string {
  if (end <= start) return text;
  const changed = text.slice(start, end);
  const leadingWhitespace = changed.match(/^\s*/)?.[0] ?? '';
  const highlightStart = start + leadingWhitespace.length;
  if (highlightStart >= end) return text;
  return `${text.slice(0, highlightStart)}${inverse(text.slice(highlightStart, end))}${text.slice(end)}`;
}

function commonPrefixLength(a: string, b: string): number {
  const max = Math.min(a.length, b.length);
  let index = 0;
  while (index < max && a[index] === b[index]) {
    index += 1;
  }
  return index;
}

function commonSuffixLength(a: string, b: string): number {
  const max = Math.min(a.length, b.length);
  let index = 0;
  while (index < max && a[a.length - index - 1] === b[b.length - index - 1]) {
    index += 1;
  }
  return index;
}

function hexToRgb(hex: string): string {
  const h = hex.replace('#', '');
  const r = Number.parseInt(h.slice(0, 2), 16);
  const g = Number.parseInt(h.slice(2, 4), 16);
  const b = Number.parseInt(h.slice(4, 6), 16);
  return `${r};${g};${b}`;
}
