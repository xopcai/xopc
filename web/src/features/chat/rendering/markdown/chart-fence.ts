/** Static Markdown accepts unclosed fences too; require a real closer before drawing persisted charts. */
export function isChartFenceClosed(source: string, startLine?: number, endLine?: number): boolean {
  if (!startLine || !endLine || endLine <= startLine) return false;
  const lines = source.split(/\r?\n/);
  const opening = lines[startLine - 1]?.match(/(?:^|[\s>])(`{3,}|~{3,})chart(?:\s|$)/)?.[1];
  if (!opening) return false;
  const closing = lines[endLine - 1]?.match(/(?:^|[\s>])(`{3,}|~{3,})[ \t]*$/)?.[1];
  return Boolean(closing && closing[0] === opening[0] && closing.length >= opening.length);
}
