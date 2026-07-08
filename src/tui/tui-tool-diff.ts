import { getThemeExports } from './theme-manager.js';

type DiffLineKind = 'context' | 'add' | 'delete';

type HunkHeader = {
  oldStart: number;
  newStart: number;
};

export type TuiFileChange = {
  kind: 'add' | 'delete' | 'update';
  path: string;
  movePath?: string;
  unifiedDiff: string;
  added: number;
  removed: number;
};

export type TuiPatchSummary = {
  files: TuiFileChange[];
  added: number;
  removed: number;
};

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
  const lineNumberWidth = getLineNumberWidth(lines);

  const rendered: string[] = [];
  let oldLine = 0;
  let newLine = 0;
  for (let index = 0; index < capped.length; index += 1) {
    const line = capped[index] ?? '';
    const next = capped[index + 1] ?? '';

    const hunk = parseHunkHeader(line);
    if (hunk) {
      oldLine = hunk.oldStart;
      newLine = hunk.newStart;
      rendered.push(header(line));
      continue;
    }

    if (isRemovedDiffLine(line) && isAddedDiffLine(next)) {
      const pair = renderReplacementPair(line, next, inverse);
      rendered.push(removed(renderDiffBodyLine(oldLine, 'delete', pair.removedLine, lineNumberWidth)));
      rendered.push(added(renderDiffBodyLine(newLine, 'add', pair.addedLine, lineNumberWidth)));
      oldLine += 1;
      newLine += 1;
      index += 1;
      continue;
    }

    if (isDiffHeaderLine(line)) {
      rendered.push(header(line));
    } else if (line.startsWith('+')) {
      rendered.push(added(renderDiffBodyLine(newLine, 'add', replaceTabs(line), lineNumberWidth)));
      newLine += 1;
    } else if (line.startsWith('-')) {
      rendered.push(removed(renderDiffBodyLine(oldLine, 'delete', replaceTabs(line), lineNumberWidth)));
      oldLine += 1;
    } else if (line === '…') {
      rendered.push(context(line));
    } else {
      rendered.push(context(renderDiffBodyLine(newLine, 'context', replaceTabs(line), lineNumberWidth)));
      oldLine += 1;
      newLine += 1;
    }
  }

  return rendered.join('\n');
}

export function parseUnifiedPatch(text: string): TuiPatchSummary | null {
  if (!looksLikeUnifiedDiff(text)) return null;

  const files: TuiFileChange[] = [];
  let current: {
    oldPath?: string;
    newPath?: string;
    hunks: string[];
    added: number;
    removed: number;
  } | null = null;

  const finish = () => {
    if (!current || current.hunks.length === 0) return;
    const oldPath = normalizeDiffPath(current.oldPath);
    const newPath = normalizeDiffPath(current.newPath);
    const path = newPath && newPath !== '/dev/null'
      ? newPath
      : oldPath && oldPath !== '/dev/null'
        ? oldPath
        : 'unknown';
    const kind = oldPath === '/dev/null'
      ? 'add'
      : newPath === '/dev/null'
        ? 'delete'
        : 'update';
    files.push({
      kind,
      path,
      unifiedDiff: current.hunks.join('\n'),
      added: current.added,
      removed: current.removed,
    });
  };

  for (const rawLine of text.split('\n')) {
    const gitMatch = rawLine.match(/^diff --git a\/(.+?) b\/(.+)$/);
    if (gitMatch) {
      finish();
      current = {
        oldPath: gitMatch[1],
        newPath: gitMatch[2],
        hunks: [rawLine],
        added: 0,
        removed: 0,
      };
      continue;
    }

    if (rawLine.startsWith('--- ')) {
      if (!current) {
        current = { hunks: [], added: 0, removed: 0 };
      }
      current.oldPath = rawLine.slice(4).trim();
      current.hunks.push(rawLine);
      continue;
    }

    if (rawLine.startsWith('+++ ')) {
      if (!current) {
        current = { hunks: [], added: 0, removed: 0 };
      }
      current.newPath = rawLine.slice(4).trim();
      current.hunks.push(rawLine);
      continue;
    }

    if (!current && rawLine.startsWith('@@')) {
      current = { hunks: [], added: 0, removed: 0 };
    }
    if (!current) continue;

    current.hunks.push(rawLine);
    if (isAddedDiffLine(rawLine)) {
      current.added += 1;
    } else if (isRemovedDiffLine(rawLine)) {
      current.removed += 1;
    }
  }
  finish();

  if (files.length === 0) return null;
  return {
    files,
    added: files.reduce((sum, file) => sum + file.added, 0),
    removed: files.reduce((sum, file) => sum + file.removed, 0),
  };
}

export function renderPatchSummary(text: string, maxLines = 120): string | null {
  const summary = parseUnifiedPatch(text);
  if (!summary) return null;

  const { theme } = getThemeExports();
  const fileCount = summary.files.length;
  const header = fileCount === 1
    ? `${changeVerb(summary.files[0]!)} ${summary.files[0]!.path} ${lineCountSummary(summary.files[0]!)}`
    : `Edited ${fileCount} files ${lineCountSummary(summary)}`;
  const rendered: string[] = [theme.accentSoft('• ') + theme.bold(header)];

  let remainingLines = Math.max(1, maxLines - 1);
  let omitted = false;
  for (const [index, file] of summary.files.entries()) {
    if (remainingLines <= 0) {
      omitted = true;
      break;
    }
    if (index > 0) {
      rendered.push('');
      remainingLines -= 1;
    }
    if (fileCount > 1) {
      rendered.push(theme.dim(`  ${changeVerb(file)} ${file.path} ${lineCountSummary(file)}`));
      remainingLines -= 1;
    }

    const diff = renderUnifiedDiff(file.unifiedDiff, Math.max(1, remainingLines))
      .split('\n')
      .map((line) => `  ${line}`)
      .join('\n');
    rendered.push(diff);
    remainingLines -= diff.split('\n').length;
  }

  if (omitted) {
    rendered.push(theme.dim('  …'));
  }

  return rendered.join('\n');
}

function isDiffHeaderLine(line: string): boolean {
  return (
    line.startsWith('+++') ||
    line.startsWith('---') ||
    line.startsWith('@@') ||
    line.startsWith('diff --git') ||
    line.startsWith('index ') ||
    line.startsWith('new file mode ') ||
    line.startsWith('deleted file mode ') ||
    line.startsWith('similarity index ') ||
    line.startsWith('rename from ') ||
    line.startsWith('rename to ')
  );
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

function renderDiffBodyLine(
  lineNumber: number,
  kind: DiffLineKind,
  line: string,
  lineNumberWidth: number,
): string {
  const gutter = lineNumber > 0 ? String(lineNumber).padStart(lineNumberWidth, ' ') : ''.padStart(lineNumberWidth, ' ');
  const marker = kind === 'add' ? '+' : kind === 'delete' ? '-' : ' ';
  const content = kind === 'context'
    ? line.startsWith(' ') ? line.slice(1) : line
    : line.slice(1);
  return `${gutter} ${marker}${content}`;
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

function parseHunkHeader(line: string): HunkHeader | null {
  const match = line.match(/^@@ -(\d+)(?:,\d+)? \+(\d+)(?:,\d+)? @@/);
  if (!match) return null;
  return {
    oldStart: Number(match[1]),
    newStart: Number(match[2]),
  };
}

function getLineNumberWidth(lines: string[]): number {
  let oldLine = 0;
  let newLine = 0;
  let maxLine = 0;
  for (const line of lines) {
    const hunk = parseHunkHeader(line);
    if (hunk) {
      oldLine = hunk.oldStart;
      newLine = hunk.newStart;
      maxLine = Math.max(maxLine, oldLine, newLine);
      continue;
    }
    if (isAddedDiffLine(line)) {
      maxLine = Math.max(maxLine, newLine);
      newLine += 1;
    } else if (isRemovedDiffLine(line)) {
      maxLine = Math.max(maxLine, oldLine);
      oldLine += 1;
    } else if (!isDiffHeaderLine(line)) {
      maxLine = Math.max(maxLine, newLine);
      oldLine += 1;
      newLine += 1;
    }
  }
  return Math.max(1, String(maxLine).length);
}

function normalizeDiffPath(path: string | undefined): string | undefined {
  if (!path) return undefined;
  const [first] = path.split(/\s+/);
  if (!first) return undefined;
  if (first === '/dev/null') return first;
  return first.replace(/^[ab]\//, '');
}

function changeVerb(file: Pick<TuiFileChange, 'kind'>): string {
  if (file.kind === 'add') return 'Added';
  if (file.kind === 'delete') return 'Deleted';
  return 'Edited';
}

function lineCountSummary(change: Pick<TuiFileChange | TuiPatchSummary, 'added' | 'removed'>): string {
  return `(+${change.added} -${change.removed})`;
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
