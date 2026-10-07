import { XopcNotePatchOperation } from '../model/note';

/** Editor span generated from canonical Markdown. */
export interface XopcNoteEditorSpan {
  /** Plain text inserted into RichEditor. */
  text: string;
  /** Inline emphasis. */
  bold: boolean;
  /** Inline emphasis. */
  italic: boolean;
  /** Heading level, or zero for body text. */
  heading: number;
  /** Whether this span is inline code. */
  code: boolean;
  /** Original Markdown for an inline note attachment image. */
  imageMarkdown?: string;
}

/** SDK-independent RichEditor result used for deterministic Markdown serialization. */
export interface XopcNoteEditorResultSpan {
  /** Plain text returned by RichEditor. */
  text: string;
  /** Resolved font size in fp. */
  fontSize: number;
  /** Resolved numeric font weight. */
  fontWeight: number;
  /** Whether italic styling is active. */
  italic: boolean;
  /** Whether inline-code styling is active. */
  code: boolean;
  imageMarkdown?: string;
}

function inlineSpans(text: string, heading: number): XopcNoteEditorSpan[] {
  const spans: XopcNoteEditorSpan[] = [];
  const pattern = /(\*\*[^*]+\*\*|__[^_]+__|\*[^*]+\*|_[^_]+_|`[^`]+`)/g;
  let cursor = 0;
  let match: RegExpExecArray | null = pattern.exec(text);
  while (match) {
    if (match.index > cursor) spans.push({ text: text.slice(cursor, match.index), bold: false, italic: false, heading, code: false });
    const token = match[0];
    const bold = token.startsWith('**') || token.startsWith('__');
    const code = token.startsWith('`');
    spans.push({ text: token.slice(bold ? 2 : 1, bold ? -2 : -1), bold, italic: !bold && !code, heading, code });
    cursor = match.index + token.length;
    match = pattern.exec(text);
  }
  if (cursor < text.length || spans.length === 0) {
    spans.push({ text: text.slice(cursor), bold: false, italic: false, heading, code: false });
  }
  return spans;
}

/** Converts the supported Markdown subset into native editor spans. */
export function noteEditorSpans(markdown: string): XopcNoteEditorSpan[] {
  if (!markdown) return [];
  const output: XopcNoteEditorSpan[] = [];
  const lines = markdown.replace(/\r\n/g, '\n').split('\n');
  lines.forEach((source: string, index: number): void => {
    if (/^!\[(?:\\.|[^\]])*\]\(xopc-attachment:\/\/notes\/[^\s)]+\)$/.test(source)) {
      output.push({ text: '', bold: false, italic: false, heading: 0, code: false, imageMarkdown: source });
      if (index < lines.length - 1) output.push({ text: '\n', bold: false, italic: false, heading: 0, code: false });
      return;
    }
    const headingMatch = /^(#{1,4})\s+(.*)$/.exec(source);
    const heading = headingMatch ? headingMatch[1].length : 0;
    const text = headingMatch ? headingMatch[2] : source;
    inlineSpans(text, heading).forEach((span: XopcNoteEditorSpan): void => { output.push(span); });
    if (index < lines.length - 1) output.push({ text: '\n', bold: false, italic: false, heading: 0, code: false });
  });
  return output;
}

/** Serializes native editor spans back to canonical Markdown. */
export function noteEditorMarkdown(spans: XopcNoteEditorResultSpan[]): string {
  let result = '';
  let lineStart = true;
  spans.forEach((span: XopcNoteEditorResultSpan): void => {
    if (span.imageMarkdown) {
      result += span.imageMarkdown;
      lineStart = false;
      return;
    }
    let value = span.text;
    if (lineStart && value !== '\n') {
      const level = span.fontSize >= 29 ? 1 : span.fontSize >= 23 ? 2 : span.fontSize >= 19 ? 3 : 0;
      if (level > 0) result += '#'.repeat(level) + ' ';
    }
    if (span.code && value.trim()) value = '`' + value + '`';
    else if (span.fontWeight >= 600 && value.trim() && span.fontSize < 19) value = '**' + value + '**';
    if (span.italic && value.trim()) value = '_' + value + '_';
    result += value;
    lineStart = value.endsWith('\n');
  });
  return result;
}

/** Applies deterministic AI patch operations without coupling them to RichEditor state. */
export function applyNotePatch(markdown: string, operations: XopcNotePatchOperation[]): string {
  let result = markdown;
  const rangeOperations = operations
    .filter((operation: XopcNotePatchOperation): boolean => operation.type === 'replaceRange' || operation.type === 'insertAt')
    .slice()
    .sort((left: XopcNotePatchOperation, right: XopcNotePatchOperation): number => operationOffset(right) - operationOffset(left));
  rangeOperations.forEach((operation: XopcNotePatchOperation): void => {
    if (operation.type === 'replaceRange') {
      const start = clamp(operation.from, 0, result.length);
      const end = clamp(operation.to, start, result.length);
      result = result.slice(0, start) + operation.markdown + result.slice(end);
    } else if (operation.type === 'insertAt') {
      const offset = clamp(operation.offset, 0, result.length);
      result = result.slice(0, offset) + operation.markdown + result.slice(offset);
    }
  });
  operations.forEach((operation: XopcNotePatchOperation): void => {
    if (operation.type === 'prependSection') {
      result = sectionMarkdown(operation.heading, operation.markdown) + (result.trim() ? '\n\n' + result : '');
    } else if (operation.type === 'appendSection') {
      result = (result.trim() ? result.replace(/\s+$/, '') + '\n\n' : '') + sectionMarkdown(operation.heading, operation.markdown);
    } else if (operation.type === 'replaceSection') {
      result = replaceSection(result, operation.sectionId, operation.markdown);
    }
  });
  return result;
}

function operationOffset(operation: XopcNotePatchOperation): number {
  if (operation.type === 'replaceRange') return operation.from;
  if (operation.type === 'insertAt') return operation.offset;
  return -1;
}

function clamp(value: number, minimum: number, maximum: number): number {
  return Math.max(minimum, Math.min(maximum, value));
}

function sectionMarkdown(heading: string, markdown: string): string {
  const title = heading.trim();
  return (title ? '## ' + title + '\n\n' : '') + markdown.trim();
}

function replaceSection(markdown: string, sectionId: string, replacement: string): string {
  const normalized = sectionId.trim().toLowerCase();
  if (!normalized) return markdown;
  const lines = markdown.split('\n');
  let start = -1;
  let end = lines.length;
  for (let index = 0; index < lines.length; index++) {
    const match = /^(#{1,6})\s+(.+)$/.exec(lines[index]);
    if (!match) continue;
    const candidate = match[2].trim().toLowerCase().replace(/[^a-z0-9\u4e00-\u9fff]+/g, '-').replace(/^-|-$/g, '');
    if (start < 0 && candidate === normalized) start = index;
    else if (start >= 0) { end = index; break; }
  }
  if (start < 0) return markdown;
  return lines.slice(0, start + 1).concat(replacement.trim().split('\n'), lines.slice(end)).join('\n');
}

/** Derives a concise title when the user leaves the title field empty. */
export function deriveNoteTitle(title: string, markdown: string): string {
  const explicit = title.trim();
  if (explicit) return explicit;
  const firstLine = markdown.split('\n').map((line: string): string => line.replace(/^#{1,6}\s+/, '').trim())
    .find((line: string): boolean => Boolean(line));
  return (firstLine ?? '').replace(/[*_`~\[\]]/g, '').slice(0, 60);
}
