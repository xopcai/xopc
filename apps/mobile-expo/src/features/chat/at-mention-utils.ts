export type AtMentionRange = { start: number; end: number; query: string };

export function detectAtMentionRange(text: string, cursor: number): AtMentionRange | null {
  const end = Math.min(Math.max(cursor, 0), text.length);
  const before = text.slice(0, end);
  const match = before.match(/@([^\s]*)$/);
  if (!match || match.index === undefined) return null;
  const start = match.index;
  if (start > 0 && /[a-zA-Z0-9_]/.test(text[start - 1])) return null;
  if (/^@file:/.test(before.slice(start))) return null;
  return { start, end, query: match[1] ?? '' };
}

export function formatWorkspacePath(path: string): string {
  if (/^[a-zA-Z0-9_./\-\p{L}\p{N}]+$/u.test(path)) return path;
  return `"${path.replace(/\\/g, '\\\\').replace(/"/g, '\\"')}"`;
}

export function replaceAtMention(text: string, range: AtMentionRange, replacement: string): string {
  return text.slice(0, range.start) + replacement + text.slice(range.end);
}
