/** Extract fenced code blocks from markdown text, joined for clipboard copy. */
export function extractMarkdownCodeBlocks(text: string): string {
  const fences = [...text.matchAll(/```[\w-]*\n?([\s\S]*?)```/g)];
  if (fences.length === 0) return '';
  return fences
    .map((match) => match[1]?.trim() ?? '')
    .filter(Boolean)
    .join('\n\n');
}
