// Attachment metadata normalization for session API / SSE / persisted transcripts.

import { inferMimeTypeFromFileName } from '@/features/chat/attachments/attachment-utils-core';
import type { Message, MessageAttachment } from '@/features/chat/messages/messages.types';

/** Normalize persisted `media[]` refs from transcript rows. */
export function normalizeWireMedia(raw: unknown): Message['attachments'] {
  if (!Array.isArray(raw)) return undefined;
  return raw.map((item) => normalizeOneMediaRef(item));
}

function normalizeOneMediaRef(item: unknown): MessageAttachment {
  if (!item || typeof item !== 'object') {
    return { name: 'file', mimeType: 'application/octet-stream' };
  }
  const a = item as Record<string, unknown>;
  const uri = normalizeMediaUri(a.uri);
  const name = normalizeName(a.name);
  const mimeType = normalizeMediaMimeType(a.mimeType, name);
  const wireType = typeof a.type === 'string' ? a.type : undefined;
  const uiType =
    wireType === 'photo' || wireType === 'image' || mimeType.startsWith('image/')
      ? 'image'
      : wireType === 'voice' || wireType === 'audio' || mimeType.startsWith('audio/')
        ? 'voice'
        : wireType;
  return {
    id: typeof a.id === 'string' ? a.id : undefined,
    name,
    mimeType,
    type: uiType,
    size: typeof a.size === 'number' ? a.size : undefined,
    uri,
    bucket: typeof a.bucket === 'string' ? a.bucket : undefined,
    path: typeof a.path === 'string' ? a.path : undefined,
  };
}

function normalizeMediaUri(raw: unknown): string | undefined {
  return typeof raw === 'string' && raw.trim().startsWith('media://') ? raw.trim() : undefined;
}

function normalizeName(raw: unknown): string {
  return typeof raw === 'string' && raw.trim().length > 0 ? raw.trim() : 'file';
}

function normalizeMediaMimeType(raw: unknown, name: string): string {
  if (typeof raw === 'string' && raw.trim().length > 0) {
    const mime = raw.trim();
    if (mime.toLowerCase().split(';')[0]?.trim() !== 'application/octet-stream') {
      return mime;
    }
  }
  return inferMimeTypeFromFileName(name) ?? 'application/octet-stream';
}

function attachmentStableKey(a: MessageAttachment): string {
  const uri = a.uri?.trim();
  if (uri) return `uri:${uri}`;
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

export type { WireMessage } from '@/features/chat/messages/wire-format';
