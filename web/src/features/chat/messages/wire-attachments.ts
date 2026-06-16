// Attachment metadata normalization for session API / SSE / persisted transcripts.

import { inferMimeTypeFromFileName } from '@/features/chat/attachments/attachment-utils-core';
import type { Message, MessageAttachment } from '@/features/chat/messages/messages.types';

export function normalizeWireAttachments(raw: unknown): Message['attachments'] {
  if (!Array.isArray(raw)) return undefined;
  return raw.map((item) => normalizeOneAttachment(item));
}

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
  const uri = typeof a.uri === 'string' && a.uri.startsWith('media://') ? a.uri : undefined;
  const name = typeof a.name === 'string' && a.name.length > 0 ? a.name : 'file';
  let mimeType = typeof a.mimeType === 'string' && a.mimeType.length > 0 ? a.mimeType : 'application/octet-stream';
  const baseMime = mimeType.split(';')[0]?.trim().toLowerCase() ?? '';
  if (baseMime === 'application/octet-stream') {
    const inferred = inferMimeTypeFromFileName(name);
    if (inferred) mimeType = inferred;
  }
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
  };
}

function normalizeOneAttachment(item: unknown): MessageAttachment {
  if (!item || typeof item !== 'object') {
    return { name: 'file', mimeType: 'application/octet-stream' };
  }
  const a = item as Record<string, unknown>;
  const uri = typeof a.uri === 'string' && a.uri.startsWith('media://') ? a.uri : undefined;
  if (uri) {
    return normalizeOneMediaRef(item);
  }

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

  const durationSeconds =
    typeof a.durationSeconds === 'number' && Number.isFinite(a.durationSeconds) && a.durationSeconds > 0
      ? a.durationSeconds
      : undefined;

  const data = typeof a.data === 'string' ? a.data : undefined;
  const content = typeof a.content === 'string' && a.content.length > 0 ? a.content : data;
  const preview =
    typeof a.preview === 'string' && a.preview.length > 0
      ? a.preview
      : mimeType.startsWith('image/') && content
        ? content
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
    durationSeconds,
  };
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
