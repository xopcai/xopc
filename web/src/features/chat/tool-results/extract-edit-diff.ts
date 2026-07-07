// Parse the unified-diff string returned by agent file mutation tools.
// `details.diff` field (see src/agent/tools/edit-diff.ts on the server) and
// produce a render-friendly representation for the EditFileCard.

import type { ParsedToolResult } from '@/features/chat/tool-results/parse-tool-result';

export type DiffLineKind = 'add' | 'del' | 'context' | 'hunk' | 'meta';

export type DiffLine = {
  kind: DiffLineKind;
  text: string;
};

export type ParsedEditDiff = {
  /** Full unified-diff source (for the copy-button / details fallback). */
  raw: string;
  /** Line-by-line decomposition for `+/-` rendering. */
  lines: DiffLine[];
  /** Number of `+` lines (excludes file-header `+++` markers). */
  added: number;
  /** Number of `-` lines (excludes file-header `---` markers). */
  removed: number;
};

const FILE_META_PREFIXES = ['---', '+++', 'diff ', 'index ', '@@'];

function classifyLine(line: string): DiffLineKind {
  if (line.startsWith('@@')) return 'hunk';
  if (line.startsWith('+++') || line.startsWith('---')) return 'meta';
  if (line.startsWith('diff ') || line.startsWith('index ')) return 'meta';
  if (line.startsWith('+')) return 'add';
  if (line.startsWith('-')) return 'del';
  return 'context';
}

/**
 * Pull `details.diff` from the parsed result and decompose it into renderable
 * lines + counts. Returns `null` if no diff is present.
 */
export function extractEditDiff(parsed: ParsedToolResult): ParsedEditDiff | null {
  const diff = parsed.details?.diff;
  if (typeof diff !== 'string' || diff.length === 0) {
    return null;
  }

  const rawLines = diff.split('\n');
  const lines: DiffLine[] = [];
  let added = 0;
  let removed = 0;
  for (const text of rawLines) {
    const kind = classifyLine(text);
    if (kind === 'add' && !text.startsWith('+++')) added++;
    if (kind === 'del' && !text.startsWith('---')) removed++;
    lines.push({ kind, text });
  }
  return { raw: diff, lines, added, removed };
}

/** True for unified-diff metadata lines that should be visually de-emphasized. */
export function isDiffMetaPrefix(line: string): boolean {
  return FILE_META_PREFIXES.some((p) => line.startsWith(p));
}
