const LARGE_PASTE_BYTES = 8 * 1024;
const LARGE_PASTE_LINES = 80;
const CODE_PASTE_BYTES = 2 * 1024;
const CODE_PASTE_LINES = 20;

export interface PastedTextAttachment {
  text: string;
  name: string;
  mimeType: string;
  byteLength: number;
  lineCount: number;
}

type PasteFormat = 'html' | 'json' | 'code' | 'text';

function detectPasteFormat(text: string): PasteFormat {
  const sample = text.trimStart().slice(0, 8 * 1024);
  if (/^(?:<!doctype\s+html\b|<(?:html|head|body)\b)/i.test(sample)) return 'html';
  if (/^<(?:div|span|section|main|article|script|style)\b/i.test(sample)) return 'html';

  const trimmed = text.trim();
  if (
    ((trimmed.startsWith('{') && trimmed.endsWith('}')) ||
      (trimmed.startsWith('[') && trimmed.endsWith(']'))) &&
    /[\":,]/.test(sample)
  ) {
    return 'json';
  }

  if (
    /(?:^|\n)\s*(?:(?:import|export|const|let|var|function|class|interface|type|def|SELECT|CREATE)\b|#!\/)/m.test(
      sample,
    ) ||
    /(?:=>|\{\s*$|;\s*$)/m.test(sample)
  ) {
    return 'code';
  }

  return 'text';
}

/** Returns a text attachment descriptor only when a paste is too large or code-dense for the editor. */
export function classifyPastedText(text: string): PastedTextAttachment | null {
  const byteLength = new TextEncoder().encode(text).byteLength;
  const lineCount = text.split(/\r\n|\n|\r/).length;
  const format = detectPasteFormat(text);
  const isCode = format !== 'text';
  const shouldAttach =
    byteLength >= LARGE_PASTE_BYTES ||
    lineCount >= LARGE_PASTE_LINES ||
    (isCode && (byteLength >= CODE_PASTE_BYTES || lineCount >= CODE_PASTE_LINES));

  if (!shouldAttach) return null;

  const file =
    format === 'html'
      ? { name: 'pasted-text.html', mimeType: 'text/html' }
      : format === 'json'
        ? { name: 'pasted-text.json', mimeType: 'application/json' }
        : format === 'code'
          ? { name: 'pasted-code.txt', mimeType: 'text/plain' }
          : { name: 'pasted-text.txt', mimeType: 'text/plain' };

  return { text, ...file, byteLength, lineCount };
}
