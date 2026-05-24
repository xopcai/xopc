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

  const lines = text.split('\n');
  const capped = lines.length > maxLines ? [...lines.slice(0, maxLines), '…'] : lines;

  return capped
    .map((line) => {
      if (line.startsWith('+++') || line.startsWith('---') || line.startsWith('@@')) {
        return header(line);
      }
      if (line.startsWith('+')) return added(line);
      if (line.startsWith('-')) return removed(line);
      if (line.startsWith('diff --git')) return header(line);
      return context(line);
    })
    .join('\n');
}

function hexToRgb(hex: string): string {
  const h = hex.replace('#', '');
  const r = Number.parseInt(h.slice(0, 2), 16);
  const g = Number.parseInt(h.slice(2, 4), 16);
  const b = Number.parseInt(h.slice(4, 6), 16);
  return `${r};${g};${b}`;
}
