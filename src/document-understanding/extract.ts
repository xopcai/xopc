import { extname } from 'node:path';

export type DocumentExtractionResult =
  | { ok: true; text: string; kind: 'plain' | 'pdf' }
  | { ok: false; reason: string };

const MAX_EXTRACTED_CHARS = 60_000;

function truncate(text: string): string {
  return text.length > MAX_EXTRACTED_CHARS
    ? `${text.slice(0, MAX_EXTRACTED_CHARS)}\n\n[document extraction truncated ${text.length - MAX_EXTRACTED_CHARS} chars]`
    : text;
}

function decodePdfEscapedString(input: string): string {
  return input
    .replace(/\\n/g, '\n')
    .replace(/\\r/g, '\n')
    .replace(/\\t/g, '\t')
    .replace(/\\\(/g, '(')
    .replace(/\\\)/g, ')')
    .replace(/\\\\/g, '\\');
}

function extractPdfLiteralStrings(raw: string): string[] {
  const out: string[] = [];
  const re = /\((?:\\.|[^\\()])*\)\s*T[Jj]/g;
  for (const match of raw.matchAll(re)) {
    const token = match[0];
    const body = token.slice(1, token.lastIndexOf(')'));
    const text = decodePdfEscapedString(body).trim();
    if (text.length >= 2) out.push(text);
  }
  return out;
}

function extractPdfHexStrings(raw: string): string[] {
  const out: string[] = [];
  const re = /<([0-9a-fA-F\s]{6,})>\s*T[Jj]/g;
  for (const match of raw.matchAll(re)) {
    const hex = (match[1] ?? '').replace(/\s+/g, '');
    if (hex.length < 6 || hex.length % 2 !== 0) continue;
    const bytes: number[] = [];
    for (let i = 0; i < hex.length; i += 2) bytes.push(Number.parseInt(hex.slice(i, i + 2), 16));
    const buf = Buffer.from(bytes);
    const utf16 = buf.length >= 2 && ((buf[0] === 0xfe && buf[1] === 0xff) || (buf[0] === 0xff && buf[1] === 0xfe));
    const text = (utf16 ? buf.toString('utf16le') : buf.toString('utf8')).replace(/[\u0000-\u001f]+/g, ' ').trim();
    if (text.length >= 2) out.push(text);
  }
  return out;
}

function extractPdfText(buffer: Buffer): DocumentExtractionResult {
  const raw = buffer.toString('latin1');
  const parts = [...extractPdfLiteralStrings(raw), ...extractPdfHexStrings(raw)]
    .map((line) => line.replace(/\s+/g, ' ').trim())
    .filter(Boolean);
  const text = Array.from(new Set(parts)).join('\n');
  if (!text.trim()) {
    return { ok: false, reason: 'PDF text extraction found no text; scanned or compressed PDFs require a dedicated extractor.' };
  }
  return { ok: true, kind: 'pdf', text: truncate(text) };
}

export function extractDocumentText(params: {
  buffer: Buffer;
  fileName: string;
  mimeType?: string;
}): DocumentExtractionResult {
  const ext = extname(params.fileName).toLowerCase();
  const mime = params.mimeType?.toLowerCase() ?? '';
  if (mime === 'application/pdf' || ext === '.pdf') return extractPdfText(params.buffer);
  if (mime.startsWith('text/')) return { ok: true, kind: 'plain', text: truncate(params.buffer.toString('utf8')) };
  return { ok: false, reason: `No document extractor registered for ${params.mimeType || ext || 'unknown type'}.` };
}
