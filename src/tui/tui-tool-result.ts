export interface TuiToolContentBlock {
  type: string;
  text?: string;
  data?: string;
  mimeType?: string;
}

export interface TuiToolResultEnvelope {
  content: TuiToolContentBlock[];
  details?: unknown;
}

export interface TuiParsedToolResult {
  envelope?: TuiToolResultEnvelope;
  text: string;
  wasJsonEnvelope: boolean;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function normalizeContentBlock(value: unknown): TuiToolContentBlock | null {
  if (!isRecord(value) || typeof value.type !== 'string') return null;
  return {
    type: value.type,
    ...(typeof value.text === 'string' ? { text: value.text } : {}),
    ...(typeof value.data === 'string' ? { data: value.data } : {}),
    ...(typeof value.mimeType === 'string' ? { mimeType: value.mimeType } : {}),
  };
}

export function parseTuiToolResult(raw: unknown): TuiParsedToolResult {
  if (raw === undefined || raw === null) {
    return { text: '', wasJsonEnvelope: false };
  }

  if (isRecord(raw) && Array.isArray(raw.content)) {
    const content = raw.content
      .map((item) => normalizeContentBlock(item))
      .filter((item): item is TuiToolContentBlock => item !== null);
    return {
      envelope: { content, details: raw.details },
      text: extractTextFromToolContent(content),
      wasJsonEnvelope: true,
    };
  }

  if (typeof raw !== 'string') {
    const text = safeStringify(raw);
    return { text, wasJsonEnvelope: false };
  }

  const trimmed = raw.trim();
  if (!trimmed.startsWith('{')) {
    return { text: raw, wasJsonEnvelope: false };
  }

  try {
    const parsed = JSON.parse(raw) as unknown;
    if (isRecord(parsed) && Array.isArray(parsed.content)) {
      const content = parsed.content
        .map((item) => normalizeContentBlock(item))
        .filter((item): item is TuiToolContentBlock => item !== null);
      return {
        envelope: { content, details: parsed.details },
        text: extractTextFromToolContent(content),
        wasJsonEnvelope: true,
      };
    }
  } catch {
    // Keep raw text fallback.
  }

  return { text: raw, wasJsonEnvelope: false };
}

export function extractTextFromToolContent(content: TuiToolContentBlock[]): string {
  return content
    .map((block) => {
      if (block.type === 'text') return block.text ?? '';
      if (block.type === 'image') {
        const label = block.mimeType ? `image:${block.mimeType}` : 'image';
        return `[${label}]`;
      }
      return block.text ?? '';
    })
    .filter(Boolean)
    .join('\n');
}

function safeStringify(value: unknown): string {
  try {
    return JSON.stringify(value, null, 2) ?? String(value);
  } catch {
    return String(value);
  }
}
