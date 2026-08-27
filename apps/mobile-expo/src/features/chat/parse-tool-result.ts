export type ParsedToolResult = {
  details: Record<string, unknown> | null;
  text: string;
};

export function asRecord(value: unknown): Record<string, unknown> | null {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
    ? value as Record<string, unknown>
    : null;
}

function textFromContent(content: unknown): string {
  if (typeof content === 'string') return content;
  if (!Array.isArray(content)) return '';
  return content
    .map(asRecord)
    .filter((item) => item?.type === 'text' && typeof item.text === 'string')
    .map((item) => item!.text as string)
    .join('\n');
}

export function parseToolResult(value: unknown): ParsedToolResult {
  const direct = asRecord(value);
  if (direct && ('details' in direct || 'content' in direct)) {
    return { details: asRecord(direct.details), text: textFromContent(direct.content) };
  }
  if (typeof value === 'string') {
    const trimmed = value.trim();
    if (trimmed.startsWith('{')) {
      try {
        const parsed = asRecord(JSON.parse(trimmed));
        if (parsed && ('details' in parsed || 'content' in parsed)) {
          return { details: asRecord(parsed.details), text: textFromContent(parsed.content) };
        }
      } catch {
        // Plain tool output.
      }
    }
    return { details: null, text: value };
  }
  return { details: null, text: value == null ? '' : String(value) };
}
