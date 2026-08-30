import { extname } from 'node:path';

import AdmZip from 'adm-zip';

export type DocumentExtractionResult =
  | { ok: true; text: string; kind: 'plain' | 'pdf' | 'office' }
  | { ok: false; reason: string };

const MAX_EXTRACTED_CHARS = 60_000;
const MAX_OFFICE_XML_BYTES = 8 * 1024 * 1024;
const MAX_OFFICE_TOTAL_XML_BYTES = 16 * 1024 * 1024;

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

function decodeXmlText(value: string): string {
  return value
    .replaceAll('&amp;', '&')
    .replaceAll('&lt;', '<')
    .replaceAll('&gt;', '>')
    .replaceAll('&quot;', '"')
    .replaceAll('&apos;', "'");
}

function officeXmlText(buffer: Buffer, extension: string): DocumentExtractionResult {
  let zip: AdmZip;
  try {
    zip = new AdmZip(buffer);
  } catch {
    return { ok: false, reason: 'Office document archive is invalid.' };
  }
  const prefixes = extension === '.docx' ? ['word/document.xml']
    : extension === '.pptx' ? ['ppt/slides/']
      : ['xl/sharedStrings.xml', 'xl/worksheets/'];
  const entries = zip.getEntries()
    .filter((entry) => !entry.isDirectory
      && entry.header.size <= MAX_OFFICE_XML_BYTES
      && prefixes.some((prefix) => entry.entryName.startsWith(prefix)))
    .sort((left, right) => left.entryName.localeCompare(right.entryName));
  const parts: string[] = [];
  let extractedBytes = 0;
  for (const entry of entries) {
    if (extractedBytes + entry.header.size > MAX_OFFICE_TOTAL_XML_BYTES) break;
    extractedBytes += entry.header.size;
    const xml = entry.getData().toString('utf8');
    for (const match of xml.matchAll(/<(?:w:t|a:t|t)(?:\s[^>]*)?>([\s\S]*?)<\/(?:w:t|a:t|t)>/g)) {
      const text = decodeXmlText((match[1] ?? '').replace(/<[^>]+>/g, '')).trim();
      if (text) parts.push(text);
    }
  }
  const text = parts.join('\n').replace(/\n{3,}/g, '\n\n').trim();
  return text
    ? { ok: true, kind: 'office', text: truncate(text) }
    : { ok: false, reason: 'Office document extraction found no readable text.' };
}

export function extractDocumentText(params: {
  buffer: Buffer;
  fileName: string;
  mimeType?: string;
}): DocumentExtractionResult {
  const ext = extname(params.fileName).toLowerCase();
  const mime = params.mimeType?.toLowerCase() ?? '';
  if (mime === 'application/pdf' || ext === '.pdf') return extractPdfText(params.buffer);
  if (['.docx', '.pptx', '.xlsx'].includes(ext)) return officeXmlText(params.buffer, ext);
  if (mime.startsWith('text/') || ['.csv', '.html', '.json', '.md', '.rtf', '.tsv', '.txt', '.xml'].includes(ext)) {
    return { ok: true, kind: 'plain', text: truncate(params.buffer.toString('utf8')) };
  }
  return { ok: false, reason: `No document extractor registered for ${params.mimeType || ext || 'unknown type'}.` };
}
