export function estimateMermaidPlaceholderHeight(code: string): number {
  const lineCount = Math.max(1, code.trim().split(/\r?\n/).length);
  return Math.min(360, Math.max(180, 120 + lineCount * 18));
}
