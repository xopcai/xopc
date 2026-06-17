import type { Note } from './types.js';
import { attachmentIdFromTarget, parseNoteAttachmentTarget } from './attachment-ref.js';
import { parseNoteMarkdown } from './note-markdown.js';

const SNIPPET_LENGTH = 100;
const MARKDOWN_IMAGE = /!\[([^\]]*)\]\(([^)]+)\)/g;
const MARKDOWN_LINK = /(?<!!)\[([^\]]*)\]\(([^)]+)\)/g;
const BARE_ATTACHMENT_REF = /xopc-attachment:\/\/notes\/[^/]+\/[^/?#"'\s)]+/gi;

export { parseNoteAttachmentTarget, buildNoteAttachmentRef } from './attachment-ref.js';

export function notePlainText(note: Pick<Note, 'id' | 'markdown'>): string {
  return note.markdown ?? '';
}

function isNoteMediaTarget(target: string): boolean {
  return parseNoteAttachmentTarget(target) !== null;
}

export function stripMediaFromPlainText(text: string): string {
  let result = text.replace(MARKDOWN_IMAGE, ' ');
  result = result.replace(MARKDOWN_LINK, (full, _alt, target) => {
    if (typeof target !== 'string') return full;
    return isNoteMediaTarget(target) ? ' ' : full;
  });
  result = result.replace(BARE_ATTACHMENT_REF, ' ');
  return result.replace(/\s+/g, ' ').trim();
}

export function extractAttachmentFileNames(note: Pick<Note, 'attachments'>): string[] | undefined {
  const names = note.attachments?.map((item) => item.fileName.trim().toLowerCase()).filter(Boolean);
  if (!names?.length) return undefined;
  return [...new Set(names)];
}

export function extractCoverAttachmentId(note: Note): string | undefined {
  const text = notePlainText(note);
  if (!text.trim()) return undefined;

  for (const match of text.matchAll(MARKDOWN_IMAGE)) {
    const target = match[2];
    if (typeof target !== 'string') continue;
    const attachmentId = attachmentIdFromTarget(target, note.id);
    if (!attachmentId) continue;
    const attachment = note.attachments?.find((item) => item.id === attachmentId);
    if (!attachment || attachment.type === 'image') return attachmentId;
  }

  for (const match of text.matchAll(BARE_ATTACHMENT_REF)) {
    const parsed = parseNoteAttachmentTarget(match[0], note.id);
    if (!parsed) continue;
    const attachment = note.attachments?.find((item) => item.id === parsed.attachmentId);
    if (!attachment || attachment.type === 'image') return parsed.attachmentId;
  }

  return undefined;
}

export function buildNoteSnippet(note: Pick<Note, 'id' | 'markdown'>): string | undefined {
  const parsed = parseNoteMarkdown(note.markdown, note.id);
  if (!parsed.plainText.trim()) return undefined;
  const clean = stripMediaFromPlainText(parsed.plainText);
  if (!clean) return undefined;
  return clean.length > SNIPPET_LENGTH ? `${clean.slice(0, SNIPPET_LENGTH)}…` : clean;
}

function extractVoiceAttachment(note: Note): { voiceAttachmentId?: string; voiceDurationSec?: number } {
  const audio = note.attachments?.find((a) => a.type === 'audio');
  if (!audio) return {};
  return { voiceAttachmentId: audio.id, voiceDurationSec: audio.duration };
}

export function buildNoteIndexMeta(note: Note): {
  snippet?: string;
  coverAttachmentId?: string;
  voiceAttachmentId?: string;
  voiceDurationSec?: number;
  attachmentNames?: string[];
  headingCount?: number;
  taskCount?: number;
  uncheckedTaskCount?: number;
  linkCount?: number;
} {
  const parsed = parseNoteMarkdown(note.markdown, note.id);
  const coverAttachmentId = extractCoverAttachmentId(note);
  const snippet = buildNoteSnippet(note);
  const attachmentNames = extractAttachmentFileNames(note);
  const { voiceAttachmentId, voiceDurationSec } = extractVoiceAttachment(note);
  return {
    snippet,
    coverAttachmentId,
    voiceAttachmentId,
    voiceDurationSec,
    attachmentNames,
    headingCount: parsed.headings.length,
    taskCount: parsed.tasks.length,
    uncheckedTaskCount: parsed.tasks.filter((task) => !task.checked).length,
    linkCount: parsed.wikilinks.length,
  };
}
