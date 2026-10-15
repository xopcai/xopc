import { createHash } from 'node:crypto';
import { constants } from 'node:fs';
import { open, lstat } from 'node:fs/promises';
import { extname } from 'node:path';
import { DatabaseSync } from 'node:sqlite';

import AdmZip from 'adm-zip';
import { DOMParser } from 'linkedom';
import * as XLSX from 'xlsx';

export interface ResultSection { id: string; title: string; offset: number; length: number; locator: Record<string, unknown> }
export interface ResultPreparation {
  database: string; documentId: string; lease: string; file?: string; expectedSha256?: string; title: string; mimeType?: string; text?: string;
}
const MAX_CHARS = 16 * 1024 * 1024;
const MAX_BYTES = 50 * 1024 * 1024;
export const RESULT_PARSER_VERSION = 2;
function charLength(text: string): number { let count = 0; for (const _char of text) count++; return count; }
export const resultFingerprint = (value: { size: number; mtimeMs: number; ctimeMs: number }) => `${value.size}:${value.mtimeMs}:${value.ctimeMs}`;

/** Runs only in a bounded background worker. No document code or macros are executed. */
export async function extractResult(input: Pick<ResultPreparation, 'file' | 'title' | 'mimeType' | 'text' | 'expectedSha256'>) {
  const units: Array<{ title: string; text: string; locator: Record<string, unknown> }> = [];
  const limitations: string[] = [];
  let bytes: Buffer;
  let fingerprint: string | undefined;
  if (input.file) {
    const before = await lstat(input.file);
    if (!before.isFile() || before.size > MAX_BYTES) throw new Error('Result exceeds the 50 MiB preparation limit');
    fingerprint = resultFingerprint(before);
    const handle = await open(input.file, constants.O_RDONLY | (constants.O_NOFOLLOW ?? 0));
    try {
      if (resultFingerprint(await handle.stat()) !== fingerprint) throw new Error('Result changed before preparation');
      const bounded = Buffer.alloc(before.size + 1);
      let offset = 0;
      while (offset < bounded.length) {
        const { bytesRead } = await handle.read(bounded, offset, bounded.length - offset, offset);
        if (!bytesRead) break;
        offset += bytesRead;
      }
      if (offset !== before.size) throw new Error('Result changed while reading');
      bytes = bounded.subarray(0, offset);
    } finally { await handle.close(); }
    if (resultFingerprint(await lstat(input.file)) !== fingerprint) throw new Error('Result changed during preparation');
  } else bytes = Buffer.from(input.text ?? '', 'utf8');
  if (input.expectedSha256 && createHash('sha256').update(bytes).digest('hex') !== input.expectedSha256) throw new Error('Published bytes differ from the immutable result revision');
  const extension = extname(input.title).toLowerCase();
  const add = (title: string, text: string, locator: Record<string, unknown>) => units.push({ title, text, locator });
  const plain = input.text !== undefined || input.mimeType?.startsWith('text/')
    || /\.(?:md|txt|json|jsonl|csv|tsv|xml|html?|[cm]?[jt]sx?|py|sh|sql|ya?ml|log|css|rs|go|swift|kt|java)$/i.test(input.title);
  if (plain) {
    const text = bytes.toString('utf8');
    if (text.includes('\0')) throw new Error('Binary data cannot be read as text');
    if (!Buffer.from(text, 'utf8').equals(bytes)) throw new Error('Text encoding is not UTF-8; explicit conversion is required');
    const headings = [...text.matchAll(/^#{1,6}\s+(.+)$/gm)];
    if (!headings.length) add('Text', text, { kind: 'text', line: 1 });
    else {
      if (headings[0]!.index) add('Introduction', text.slice(0, headings[0]!.index), { kind: 'text', line: 1 });
      let line = text.slice(0, headings[0]!.index).split('\n').length;
      for (let i = 0; i < headings.length; i++) {
        const match = headings[i]!;
        const part = text.slice(match.index, headings[i + 1]?.index ?? text.length);
        add(match[1]!, part, { kind: 'section', line });
        line += part.split('\n').length - 1;
      }
    }
  } else if (extension === '.pdf' || input.mimeType === 'application/pdf') {
    const { getDocument } = await import('pdfjs-dist/legacy/build/pdf.mjs');
    const task = getDocument({ data: new Uint8Array(bytes), useSystemFonts: false, stopAtErrors: true });
    const pdf = await task.promise;
    try {
      for (let page = 1; page <= pdf.numPages; page++) {
        const content = await (await pdf.getPage(page)).getTextContent();
        add(`Page ${page}`, content.items.map(item => 'str' in item ? `${item.str}${item.hasEOL ? '\n' : ' '}` : '').join(''), { kind: 'page', page });
      }
    } finally { await task.destroy(); }
    limitations.push('Extracted PDF text; layout and visual content are not verified. Empty pages may require OCR.');
  } else if (extension === '.docx' || extension === '.pptx') {
    const zip = new AdmZip(bytes);
    const entries = zip.getEntries().filter(entry => !entry.isDirectory && (extension === '.docx'
      ? entry.entryName === 'word/document.xml' : /^ppt\/slides\/slide\d+\.xml$/.test(entry.entryName)))
      .sort((a, b) => a.entryName.localeCompare(b.entryName, undefined, { numeric: true }));
    if (entries.reduce((total, entry) => total + entry.header.size, 0) > 32 * 1024 * 1024) throw new Error('Office XML exceeds extraction budget');
    for (const [index, entry] of entries.entries()) {
      const document = new DOMParser().parseFromString(entry.getData().toString('utf8'), 'text/xml');
      if (extension === '.docx') {
        const paragraphs = [...document.getElementsByTagName('w:p')];
        for (const [paragraph, node] of paragraphs.entries()) {
          const text = [...node.getElementsByTagName('w:t')].map(item => item.textContent ?? '').join('');
          add(`Paragraph ${paragraph + 1}`, text, { kind: 'paragraph', paragraph: paragraph + 1 });
        }
      } else add(`Slide ${index + 1}`, [...document.getElementsByTagName('a:p')]
        .map(node => [...node.getElementsByTagName('a:t')].map(item => item.textContent ?? '').join('')).join('\n'), { kind: 'slide', slide: index + 1 });
    }
    limitations.push('Extracted document text; embedded images, charts, comments and layout are not included.');
  } else if (['.xlsx', '.xls'].includes(extension)) {
    const book = XLSX.read(bytes, { type: 'buffer', cellFormula: true, cellText: true });
    for (const sheet of book.SheetNames) {
      const data = book.Sheets[sheet]!;
      const cells = Object.keys(data).filter(key => !key.startsWith('!')).map(address => {
        const cell = data[address]!;
        return `${address}: ${JSON.stringify({ value: cell.v ?? null, displayed: cell.w ?? null, ...(cell.f ? { formula: cell.f } : {}) })}`;
      });
      add(sheet, cells.join('\n'), { kind: 'sheet', sheet });
    }
    limitations.push('Stored cell values and formula caches; formulas are not recalculated. Charts, macros and formatting are not evaluated.');
  } else return { unsupported: true as const, reason: 'No text representation for this format. Use the delivered preview or delegate new media analysis.' };
  let text = '';
  let offset = 0;
  const sections: ResultSection[] = [];
  for (const [index, unit] of units.entries()) {
    if (text.length + unit.text.length > MAX_CHARS || sections.length >= 100_000) throw new Error('Extracted content exceeds preparation budget; full content was not indexed');
    const length = charLength(unit.text);
    sections.push({ id: String(index + 1), title: unit.title.slice(0, 200), offset, length, locator: unit.locator });
    offset += length;
    text += unit.text;
    // Plain-text sections are exact contiguous slices; document units use a separating newline.
    if (!plain && index < units.length - 1) { text += '\n'; offset++; }
  }
  if (!text.trim()) return { unsupported: true as const, reason: 'No readable text was extracted; visual or OCR analysis may be required.' };
  return { unsupported: false as const, text, sections, limitations, fingerprint,
    revision: createHash('sha256').update(bytes).update(`parser:${RESULT_PARSER_VERSION}`).digest('hex') };
}

export async function prepareResultDocument(input: ResultPreparation): Promise<void> {
  const db = new DatabaseSync(input.database);
  db.exec('PRAGMA foreign_keys = ON; PRAGMA busy_timeout = 1000');
  try {
    const value = await extractResult(input);
    const owns = () => db.prepare('SELECT 1 FROM personal_result_documents WHERE document_id = ? AND lease_token = ?')
      .get(input.documentId, input.lease);
    if (!owns()) return;
    if (value.unsupported) {
      db.prepare("UPDATE personal_result_documents SET status = 'unsupported', error = ?, lease_until = 0 WHERE document_id = ? AND lease_token = ?")
        .run(value.reason, input.documentId, input.lease);
      return;
    }
    // Small transactions bound contention with foreground writes; partial indexes are never served.
    db.prepare('DELETE FROM personal_result_search WHERE document_id = ?').run(input.documentId);
    db.prepare('DELETE FROM personal_result_sections WHERE document_id = ?').run(input.documentId);
    const addSection = db.prepare('INSERT INTO personal_result_sections VALUES (?, ?, ?, ?, ?, ?, ?)');
    for (const [ordinal, section] of value.sections.entries()) {
      if (!owns()) return;
      addSection.run(input.documentId, section.id, ordinal, section.title, section.offset, section.length, JSON.stringify(section.locator));
    }
    const insert = db.prepare('INSERT INTO personal_result_search(document_id, start_offset, text) VALUES (?, ?, ?)');
    let characterOffset = 0;
    for (let offset = 0; offset < value.text.length;) {
      db.exec('BEGIN IMMEDIATE');
      try {
        if (!owns()) { db.exec('ROLLBACK'); return; }
        const end = Math.min(value.text.length, offset + 24_000);
        for (; offset < end;) {
          let next = Math.min(value.text.length, offset + 3000);
          if (next < value.text.length && /[\uD800-\uDBFF]/.test(value.text[next - 1]!)) next++;
          insert.run(input.documentId, characterOffset, value.text.slice(offset, next + 512));
          characterOffset += charLength(value.text.slice(offset, next));
          offset = next;
        }
        db.exec('COMMIT');
      } catch (error) { db.exec('ROLLBACK'); throw error; }
    }
    db.prepare(`UPDATE personal_result_documents SET status = 'ready', content_revision = ?, content = ?,
      sections_json = ?, limitations_json = ?, fingerprint = ?, error = NULL, lease_until = 0 WHERE document_id = ? AND lease_token = ?`)
      .run(value.revision, value.text, '[]', JSON.stringify(value.limitations), value.fingerprint ?? null, input.documentId, input.lease);
  } catch (error) {
    db.prepare("UPDATE personal_result_documents SET status = 'failed', error = ?, lease_until = 0 WHERE document_id = ? AND lease_token = ?")
      .run((error instanceof Error ? error.message : String(error)).slice(0, 500), input.documentId, input.lease);
  } finally { db.close(); }
}
