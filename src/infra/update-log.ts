export function trimLogTail(text: string | null | undefined, maxChars: number): string | null {
  if (!text) return null;
  const trimmed = text.trim();
  if (!trimmed) return null;
  if (trimmed.length <= maxChars) return trimmed;
  return trimmed.slice(-maxChars);
}
