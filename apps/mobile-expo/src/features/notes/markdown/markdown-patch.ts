import type { NotePatchOperation, NoteStatus } from '../../../query/notes';
import { getMarkdownOutline, stripMarkdownFrontmatter } from './markdown-document';

export interface MarkdownPatchResult {
  markdown: string;
  metadata: {
    title?: string | null;
    tags?: string[];
    status?: NoteStatus;
    frontmatter?: Record<string, string | number | boolean | Array<string | number | boolean> | null>;
  };
}

export interface MarkdownPatchPreviewSnippets {
  before: string;
  after: string;
  changed: boolean;
}

export interface MarkdownPatchChangedRange {
  start: number;
  end: number;
}

export function applyMarkdownPatch(markdown: string, operations: NotePatchOperation[]): string {
  return applyMarkdownPatchResult(markdown, operations).markdown;
}

export function applyMarkdownPatchResult(markdown: string, operations: NotePatchOperation[]): MarkdownPatchResult {
  let next = markdown;
  const metadata: MarkdownPatchResult['metadata'] = {};
  const rangeOps = operations.filter(
    (op): op is Extract<NotePatchOperation, { type: 'replaceRange' | 'insertAt' }> =>
      op.type === 'replaceRange' || op.type === 'insertAt',
  );

  for (const op of [...rangeOps].sort((a, b) => {
    const ao = opOffset(a);
    const bo = opOffset(b);
    return bo - ao;
  })) {
    if (op.type === 'insertAt') {
      const offset = clamp(op.offset, 0, next.length);
      next = `${next.slice(0, offset)}${op.markdown}${next.slice(offset)}`;
    } else {
      const from = clamp(Math.min(op.from, op.to), 0, next.length);
      const to = clamp(Math.max(op.from, op.to), 0, next.length);
      next = `${next.slice(0, from)}${op.markdown}${next.slice(to)}`;
    }
  }

  for (const op of operations) {
    if (op.type === 'appendSection') {
      next = `${next.trimEnd()}\n\n## ${op.heading}\n\n${op.markdown.trim()}\n`;
    } else if (op.type === 'prependSection') {
      next = `## ${op.heading}\n\n${op.markdown.trim()}\n\n${next.trimStart()}`;
    } else if (op.type === 'replaceSection') {
      next = replaceSection(next, op.sectionId, op.markdown);
    } else if (op.type === 'updateFrontmatter') {
      next = updateFrontmatter(next, op.patch);
      const frontmatter = serializableFrontmatterPatch(op.patch);
      if (Object.keys(frontmatter).length > 0) {
        metadata.frontmatter = { ...metadata.frontmatter, ...frontmatter };
      }
    } else if (op.type === 'updateMetadata') {
      if (op.title !== undefined) metadata.title = op.title;
      if (op.tags !== undefined) metadata.tags = op.tags;
      if (op.status !== undefined) metadata.status = op.status;
    }
  }

  return { markdown: next, metadata };
}

export function getMarkdownPatchPreviewSnippets(before: string, after: string, contextChars = 180, maxChars = 700): MarkdownPatchPreviewSnippets {
  const visibleBefore = stripMarkdownFrontmatter(before);
  const visibleAfter = stripMarkdownFrontmatter(after);
  if (visibleBefore === visibleAfter) {
    return {
      before: trimPreviewSnippet(visibleBefore, 0, maxChars),
      after: trimPreviewSnippet(visibleAfter, 0, maxChars),
      changed: false,
    };
  }

  const prefixLength = commonPrefixLength(visibleBefore, visibleAfter);
  const suffixLength = commonSuffixLength(visibleBefore, visibleAfter, prefixLength);
  const beforeEnd = Math.max(prefixLength, visibleBefore.length - suffixLength);
  const afterEnd = Math.max(prefixLength, visibleAfter.length - suffixLength);
  const beforeStart = Math.max(0, prefixLength - contextChars);
  const afterStart = Math.max(0, prefixLength - contextChars);
  const beforePreviewEnd = Math.min(visibleBefore.length, beforeEnd + contextChars);
  const afterPreviewEnd = Math.min(visibleAfter.length, afterEnd + contextChars);

  return {
    before: trimPreviewSnippet(visibleBefore, beforeStart, maxChars, beforePreviewEnd),
    after: trimPreviewSnippet(visibleAfter, afterStart, maxChars, afterPreviewEnd),
    changed: true,
  };
}

export function getMarkdownPatchChangedRange(before: string, after: string): MarkdownPatchChangedRange | null {
  if (before === after) return null;
  const prefixLength = commonPrefixLength(before, after);
  const suffixLength = commonSuffixLength(before, after, prefixLength);
  const range = {
    start: prefixLength,
    end: Math.max(prefixLength, after.length - suffixLength),
  };
  return expandRangeToWordBoundaries(after, range);
}

function opOffset(op: Extract<NotePatchOperation, { type: 'replaceRange' | 'insertAt' }>): number {
  return op.type === 'insertAt' ? op.offset : op.from;
}

function clamp(value: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, value));
}

function commonPrefixLength(a: string, b: string): number {
  const limit = Math.min(a.length, b.length);
  let index = 0;
  while (index < limit && a[index] === b[index]) index += 1;
  return index;
}

function commonSuffixLength(a: string, b: string, prefixLength: number): number {
  const limit = Math.min(a.length, b.length) - prefixLength;
  let length = 0;
  while (length < limit && a[a.length - 1 - length] === b[b.length - 1 - length]) length += 1;
  return length;
}

function trimPreviewSnippet(source: string, start: number, maxChars: number, preferredEnd?: number): string {
  if (!source) return '';
  const normalizedStart = clamp(start, 0, source.length);
  const end = clamp(preferredEnd ?? normalizedStart + maxChars, normalizedStart, source.length);
  const boundedEnd = Math.min(source.length, Math.max(end, normalizedStart + 1), normalizedStart + maxChars);
  const prefix = normalizedStart > 0 ? '...\n' : '';
  const suffix = boundedEnd < source.length ? '\n...' : '';
  return `${prefix}${source.slice(normalizedStart, boundedEnd).trim()}${suffix}`;
}

function expandRangeToWordBoundaries(source: string, range: MarkdownPatchChangedRange): MarkdownPatchChangedRange {
  if (range.start === range.end) return range;
  let start = range.start;
  let end = range.end;
  while (start > 0 && isWordChar(source[start - 1]) && isWordChar(source[start])) start -= 1;
  while (end < source.length && isWordChar(source[end - 1]) && isWordChar(source[end])) end += 1;
  return { start, end };
}

function isWordChar(char: string | undefined): boolean {
  return char != null && /[\p{L}\p{N}_-]/u.test(char);
}

function replaceSection(markdown: string, sectionId: string, replacement: string): string {
  const outline = getMarkdownOutline(markdown);
  const target = normalizeSectionId(sectionId);
  const exactSection = outline.find((item) => item.id === sectionId);
  const section = exactSection ?? outline.find((item) => (
    normalizeSectionId(item.id) === target
    || normalizeSectionId(item.title) === target
  ));

  if (section) {
    const headingEnd = markdown.indexOf('\n', section.range.start);
    const contentStart = headingEnd >= 0 ? headingEnd : section.range.end;
    let sectionEnd = markdown.length;
    const sectionIndex = outline.findIndex((item) => item.id === section.id && item.range.start === section.range.start);
    for (let index = sectionIndex + 1; index < outline.length; index += 1) {
      const next = outline[index];
      if (next.level <= section.level) {
        sectionEnd = Math.max(0, next.range.start - 1);
        break;
      }
    }

    const body = replacement.trim();
    const nextBody = body ? `\n\n${body}${sectionEnd < markdown.length ? '\n' : ''}` : '';
    return `${markdown.slice(0, contentStart)}${nextBody}${markdown.slice(sectionEnd)}`;
  }

  const lines = markdown.split('\n');

  let charOffset = 0;
  for (let index = 0; index < lines.length; index += 1) {
    const line = lines[index];
    const heading = /^(#{1,6})\s+(.+)$/.exec(line);
    if (!heading) {
      charOffset += line.length + 1;
      continue;
    }

    const level = heading[1].length;
    const headingText = heading[2].replace(/\s*\{#[^}]+}\s*$/, '').trim();
    const explicitId = /\{#([^}]+)}/.exec(heading[2])?.[1];
    const matches = normalizeSectionId(explicitId ?? headingText) === target
      || normalizeSectionId(headingText) === target;
    const headingStart = charOffset;
    const contentStart = headingStart + line.length;
    charOffset += line.length + 1;

    if (!matches) continue;

    let sectionEnd = markdown.length;
    let scanOffset = charOffset;
    for (let scan = index + 1; scan < lines.length; scan += 1) {
      const nextHeading = /^(#{1,6})\s+/.exec(lines[scan]);
      if (nextHeading && nextHeading[1].length <= level) {
        sectionEnd = Math.max(0, scanOffset - 1);
        break;
      }
      scanOffset += lines[scan].length + 1;
    }

    const body = replacement.trim();
    const nextBody = body ? `\n\n${body}${sectionEnd < markdown.length ? '\n' : ''}` : '';
    return `${markdown.slice(0, contentStart)}${nextBody}${markdown.slice(sectionEnd)}`;
  }

  return `${markdown.trimEnd()}\n\n${replacement.trim()}\n`;
}

function normalizeSectionId(value: string): string {
  return value
    .trim()
    .toLowerCase()
    .replace(/[`*_~[\]()]/g, '')
    .replace(/[^a-z0-9\u4e00-\u9fa5]+/g, '-')
    .replace(/^-+|-+$/g, '');
}

function updateFrontmatter(markdown: string, patch: Record<string, unknown>): string {
  const parsed = parseFrontmatter(markdown);
  const nextFields = { ...parsed.fields };
  for (const [key, value] of Object.entries(patch)) {
    if (!isFrontmatterKey(key)) continue;
    if (value == null) {
      delete nextFields[key];
    } else {
      nextFields[key] = value;
    }
  }

  const frontmatter = serializeFrontmatter(nextFields);
  if (!frontmatter) return parsed.body.trimStart();
  return `---\n${frontmatter}---\n\n${parsed.body.trimStart()}`;
}

function parseFrontmatter(markdown: string): { fields: Record<string, unknown>; body: string } {
  const normalized = markdown.replace(/\r\n/g, '\n');
  if (!normalized.startsWith('---\n')) return { fields: {}, body: normalized };
  const end = normalized.indexOf('\n---', 4);
  if (end < 0) return { fields: {}, body: normalized };
  const raw = normalized.slice(4, end);
  const bodyStart = normalized[end + 4] === '\n' ? end + 5 : end + 4;
  const fields: Record<string, unknown> = {};
  for (const line of raw.split('\n')) {
    const match = /^([A-Za-z0-9_-]+):\s*(.*)$/.exec(line);
    if (!match) continue;
    fields[match[1]] = parseFrontmatterValue(match[2]);
  }
  return { fields, body: normalized.slice(bodyStart) };
}

function serializeFrontmatter(fields: Record<string, unknown>): string {
  return Object.entries(fields)
    .filter(([key, value]) => isFrontmatterKey(key) && value != null && isSerializableFrontmatterValue(value))
    .map(([key, value]) => `${key}: ${serializeFrontmatterValue(value)}\n`)
    .join('');
}

function parseFrontmatterValue(raw: string): unknown {
  const value = raw.trim();
  if (!value) return '';
  if (value === 'true') return true;
  if (value === 'false') return false;
  if (/^-?\d+(\.\d+)?$/.test(value)) return Number(value);
  if (value.startsWith('[') && value.endsWith(']')) {
    return value.slice(1, -1).split(',').map((item) => parseFrontmatterValue(item)).filter((item) => item !== '');
  }
  return value.replace(/^"(.*)"$/, '$1').replace(/\\"/g, '"');
}

function serializeFrontmatterValue(value: unknown): string {
  if (Array.isArray(value)) {
    return `[${value.filter(isSerializableFrontmatterScalar).map(serializeFrontmatterValue).join(', ')}]`;
  }
  if (typeof value === 'string') return JSON.stringify(value);
  return String(value);
}

function serializableFrontmatterPatch(patch: Record<string, unknown>): NonNullable<MarkdownPatchResult['metadata']['frontmatter']> {
  const next: NonNullable<MarkdownPatchResult['metadata']['frontmatter']> = {};
  for (const [key, value] of Object.entries(patch)) {
    if (!isFrontmatterKey(key)) continue;
    if (value == null) {
      next[key] = null;
    } else if (isSerializableFrontmatterValue(value)) {
      next[key] = value;
    }
  }
  return next;
}

function isSerializableFrontmatterValue(value: unknown): value is string | number | boolean | Array<string | number | boolean> {
  return isSerializableFrontmatterScalar(value) || (Array.isArray(value) && value.every(isSerializableFrontmatterScalar));
}

function isSerializableFrontmatterScalar(value: unknown): value is string | number | boolean {
  return typeof value === 'string' || typeof value === 'number' || typeof value === 'boolean';
}

function isFrontmatterKey(key: string): boolean {
  return /^[A-Za-z0-9_-]+$/.test(key);
}
