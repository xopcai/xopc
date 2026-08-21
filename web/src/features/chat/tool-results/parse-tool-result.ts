// Tool-result wire shapes diverge by ingestion path:
//   - Live run: serialized JSON of the agent's full `{ content, details }` object.
//   - History rehydration (agent-messages.ts): only `content[].text` concatenated.
// All structured cards must therefore tolerate either form: try to JSON-parse
// for `details`/`content` first, fall back to the raw text otherwise.

export type ParsedToolResult = {
  /** Structured details returned by the agent tool (`details` field). Null when unavailable. */
  details: Record<string, unknown> | null;
  /** Concatenated human-readable text content (the model-facing string output). */
  text: string;
  /** True when the raw payload parsed as a `{ content, details }` envelope. */
  isStructured: boolean;
};

function asObject(v: unknown): Record<string, unknown> | null {
  return v && typeof v === 'object' && !Array.isArray(v) ? (v as Record<string, unknown>) : null;
}

function joinTextBlocks(content: unknown): string {
  if (typeof content === 'string') return content;
  if (!Array.isArray(content)) return '';
  const parts: string[] = [];
  for (const item of content) {
    if (!item || typeof item !== 'object') continue;
    const rec = item as Record<string, unknown>;
    if (rec.type === 'text' && typeof rec.text === 'string') {
      parts.push(rec.text);
    }
  }
  return parts.join('\n');
}

/**
 * Normalize whatever the chat store stored under `block.result` into a
 * `{ details, text, isStructured }` triple. Never throws.
 */
export function parseToolResult(raw: unknown): ParsedToolResult {
  if (raw == null) {
    return { details: null, text: '', isStructured: false };
  }
  if (typeof raw === 'object' && !Array.isArray(raw)) {
    const obj = raw as Record<string, unknown>;
    if ('content' in obj || 'details' in obj) {
      return {
        details: asObject(obj.details),
        text: joinTextBlocks(obj.content),
        isStructured: true,
      };
    }
    return { details: null, text: '', isStructured: false };
  }
  if (typeof raw === 'string') {
    const trimmed = raw.trim();
    if (trimmed.startsWith('{')) {
      try {
        const parsed = JSON.parse(trimmed) as unknown;
        const obj = asObject(parsed);
        if (obj && ('content' in obj || 'details' in obj)) {
          return {
            details: asObject(obj.details),
            text: joinTextBlocks(obj.content),
            isStructured: true,
          };
        }
      } catch {
        // not an envelope; fall through and treat the entire string as text
      }
    }
    return { details: null, text: raw, isStructured: false };
  }
  return { details: null, text: String(raw), isStructured: false };
}
