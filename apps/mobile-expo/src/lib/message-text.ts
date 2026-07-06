/** Best-effort plain text from gateway session `Message.content`. */
export function messageContentToString(content: unknown): string {
  if (typeof content === 'string') return content;
  if (!Array.isArray(content)) return '';
  const parts: string[] = [];
  for (const block of content) {
    if (!block || typeof block !== 'object') continue;
    const o = block as Record<string, unknown>;
    if (o.type === 'text' && typeof o.text === 'string') parts.push(o.text);
  }
  return parts.join('\n');
}
