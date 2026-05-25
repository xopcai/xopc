// Attachment-shaped normalization for messages coming off the wire (session API,
// agent stream, persisted transcripts). All dedup/merge of `Message['attachments']`
// lives here so `agent-messages.ts` stays focused on content-block orchestration.

import { inferMimeTypeFromFileName } from '@/features/chat/attachments/attachment-utils-core';
import type { Message, MessageAttachment } from '@/features/chat/messages/messages.types';

export function normalizeWireAttachments(raw: unknown): Message['attachments'] {
  if (!Array.isArray(raw)) return undefined;
  return raw.map((item) => normalizeOneAttachment(item));
}

function normalizeOneAttachment(item: unknown): MessageAttachment {
  if (!item || typeof item !== 'object') {
    return { name: 'file', mimeType: 'application/octet-stream' };
  }
  const a = item as Record<string, unknown>;
  const data = typeof a.data === 'string' ? a.data : undefined;
  const content =
    typeof a.content === 'string' && a.content.length > 0 ? a.content : data;
  const name = typeof a.name === 'string' && a.name.length > 0 ? a.name : 'file';
  let mimeType = typeof a.mimeType === 'string' && a.mimeType.length > 0 ? a.mimeType : '';
  if (!mimeType && typeof a.type === 'string' && a.type.includes('/')) {
    mimeType = a.type;
  }
  if (!mimeType) {
    mimeType = 'application/octet-stream';
  }
  const baseMime = mimeType.split(';')[0]?.trim().toLowerCase() ?? '';
  if (baseMime === 'application/octet-stream' || baseMime === '') {
    const inferred = inferMimeTypeFromFileName(name);
    if (inferred) {
      mimeType = inferred;
    }
  }
  const preview =
    typeof a.preview === 'string' && a.preview.length > 0
      ? a.preview
      : mimeType.startsWith('image/') && content
        ? content
        : undefined;

  const durationSeconds =
    typeof a.durationSeconds === 'number' && Number.isFinite(a.durationSeconds) && a.durationSeconds > 0
      ? a.durationSeconds
      : undefined;

  return {
    id: typeof a.id === 'string' ? a.id : undefined,
    name,
    mimeType,
    type: typeof a.type === 'string' ? a.type : undefined,
    size: typeof a.size === 'number' ? a.size : undefined,
    content,
    data: data ?? content,
    preview,
    extractedText: typeof a.extractedText === 'string' ? a.extractedText : undefined,
    workspaceRelativePath:
      typeof a.workspaceRelativePath === 'string' && a.workspaceRelativePath.length > 0
        ? a.workspaceRelativePath
        : undefined,
    durationSeconds,
  };
}

function parseFileLineMeta(fileMeta: string): { name: string; mimeType: string; size: number } {
  const nameMatch = fileMeta.match(/^([^(]+?)\s*\(/);
  const name = nameMatch ? nameMatch[1].trim() : 'file';
  const mimeMatch = fileMeta.match(/\(\s*([^,]+)\s*,\s*(\d+)\s*bytes\s*\)/i);
  const mimeType = mimeMatch ? mimeMatch[1].trim() : 'application/octet-stream';
  const size = mimeMatch ? parseInt(mimeMatch[2], 10) : 0;
  return { name, mimeType, size };
}

export function extractAttachmentsFromUserContent(raw: unknown): Message['attachments'] | undefined {
  const chunks: string[] = [];
  if (typeof raw === 'string') {
    chunks.push(raw);
  } else if (Array.isArray(raw)) {
    for (const item of raw) {
      if (item && typeof item === 'object' && (item as { type?: string }).type === 'text') {
        const t = (item as { text?: string }).text;
        if (typeof t === 'string') chunks.push(t);
      }
    }
  }
  const text = chunks.join('\n');
  if (!text.includes('xopc-path:rel:')) return undefined;

  const out: NonNullable<Message['attachments']> = [];
  const seen = new Set<string>();

  // Single line: rel is \S+ so it stops before " xopc-path:abs:" (fixes greedy [^\n]+ bug)
  const reSingle = /\[File: ([^\]]+)\]\s*xopc-path:rel:(\S+)\s*xopc-path:abs:\S+/g;
  let m: RegExpExecArray | null;
  while ((m = reSingle.exec(text)) !== null) {
    const rel = m[2].trim();
    if (seen.has(rel)) continue;
    seen.add(rel);
    const { name, mimeType, size } = parseFileLineMeta(m[1]);
    out.push({
      name,
      mimeType,
      size,
      type: 'document',
      workspaceRelativePath: rel,
    });
  }

  const reMulti =
    /\[File: ([^\]]+)\]\s*\r?\nxopc-path:rel:([^\r\n]+)\r?\n\s*xopc-path:abs:[^\r\n]+/g;
  while ((m = reMulti.exec(text)) !== null) {
    const rel = m[2].trim();
    if (seen.has(rel)) continue;
    seen.add(rel);
    const { name, mimeType, size } = parseFileLineMeta(m[1]);
    out.push({
      name,
      mimeType,
      size,
      type: 'document',
      workspaceRelativePath: rel,
    });
  }

  return out.length ? out : undefined;
}

/** Deduplicate attachments that refer to the same workspace file (wire + parsed content often disagree on `name`). */
function attachmentStableKey(a: MessageAttachment): string {
  const rel = a.workspaceRelativePath?.replace(/\\/g, '/').trim();
  if (rel) return `rel:${rel}`;
  if (a.id) return `id:${a.id}`;
  return `name:${a.name ?? 'file'}|${a.mimeType ?? ''}`;
}

export function dedupeAttachments(list: Message['attachments'] | undefined): Message['attachments'] | undefined {
  if (!list?.length) return undefined;
  const out: NonNullable<Message['attachments']> = [];
  const seen = new Set<string>();
  for (const a of list) {
    const k = attachmentStableKey(a);
    if (seen.has(k)) continue;
    seen.add(k);
    out.push(a);
  }
  return out.length ? out : undefined;
}

export function mergeUserAttachments(
  wire: Message['attachments'] | undefined,
  fromContent: Message['attachments'] | undefined,
): Message['attachments'] | undefined {
  return dedupeAttachments([...(wire ?? []), ...(fromContent ?? [])]);
}
