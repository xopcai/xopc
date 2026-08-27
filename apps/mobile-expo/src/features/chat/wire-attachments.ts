import type { MessageAttachment } from './messages.types';
import { mimeTypeFromFileName } from './tool-result-file-paths';

function normalizeAttachment(item: unknown): MessageAttachment | null {
  if (!item || typeof item !== 'object' || Array.isArray(item)) return null;
  const value = item as Record<string, unknown>;
  const name = typeof value.name === 'string' && value.name.trim() ? value.name.trim() : undefined;
  const rawMimeType = typeof value.mimeType === 'string' && value.mimeType.trim()
    ? value.mimeType.trim()
    : undefined;
  const mimeType = rawMimeType && rawMimeType !== 'application/octet-stream'
    ? rawMimeType
    : name
      ? mimeTypeFromFileName(name)
      : rawMimeType;
  const wireType = typeof value.type === 'string' ? value.type : undefined;
  const type = wireType === 'photo' || wireType === 'image' || mimeType?.startsWith('image/')
    ? 'image'
    : wireType === 'voice' || wireType === 'audio' || mimeType?.startsWith('audio/')
      ? 'audio'
      : wireType;

  const attachment: MessageAttachment = {
    id: typeof value.id === 'string' ? value.id : undefined,
    name,
    type,
    mimeType,
    size: typeof value.size === 'number' ? value.size : undefined,
    content: typeof value.content === 'string' ? value.content : undefined,
    data: typeof value.data === 'string' ? value.data : undefined,
    preview: typeof value.preview === 'string' ? value.preview : undefined,
    extractedText: typeof value.extractedText === 'string' ? value.extractedText : undefined,
    uri: typeof value.uri === 'string' ? value.uri : undefined,
    localUri: typeof value.localUri === 'string' ? value.localUri : undefined,
    workspaceRelativePath:
      typeof value.workspaceRelativePath === 'string' ? value.workspaceRelativePath : undefined,
    durationSeconds: typeof value.durationSeconds === 'number' ? value.durationSeconds : undefined,
    bucket: typeof value.bucket === 'string' ? value.bucket : undefined,
    path: typeof value.path === 'string' ? value.path : undefined,
  };
  const hasPayload = attachment.id
    || attachment.name
    || attachment.uri
    || attachment.localUri
    || attachment.workspaceRelativePath
    || attachment.path
    || attachment.content
    || attachment.data;
  return hasPayload ? attachment : null;
}

function attachmentKeys(attachment: MessageAttachment): string[] {
  const keys: string[] = [];
  if (attachment.uri?.trim()) keys.push(`uri:${attachment.uri.trim()}`);
  if (attachment.workspaceRelativePath?.trim()) {
    keys.push(`workspace:${attachment.workspaceRelativePath.replace(/\\/g, '/').replace(/^\/+/, '')}`);
  }
  if (attachment.id?.trim()) keys.push(`id:${attachment.id.trim()}`);
  if (attachment.localUri?.trim()) keys.push(`local:${attachment.localUri.trim()}`);
  if (attachment.path?.trim()) keys.push(`path:${attachment.path.trim()}`);
  if (keys.length === 0) {
    keys.push(`name:${attachment.name ?? 'file'}|${attachment.mimeType ?? ''}|${attachment.size ?? ''}`);
  }
  return keys;
}

function mergeAttachment(
  current: MessageAttachment,
  incoming: MessageAttachment,
): MessageAttachment {
  const definedIncoming = Object.fromEntries(
    Object.entries(incoming).filter(([, value]) => value !== undefined),
  ) as MessageAttachment;
  return { ...current, ...definedIncoming };
}

export function dedupeAttachments(
  attachments: readonly MessageAttachment[] | undefined,
): MessageAttachment[] | undefined {
  if (!attachments?.length) return undefined;
  const indexByKey = new Map<string, number>();
  const result: MessageAttachment[] = [];
  for (const attachment of attachments) {
    const keys = attachmentKeys(attachment);
    const existingIndex = keys
      .map((key) => indexByKey.get(key))
      .find((index): index is number => index !== undefined);
    if (existingIndex !== undefined) {
      const merged = mergeAttachment(result[existingIndex], attachment);
      result[existingIndex] = merged;
      for (const key of attachmentKeys(merged)) indexByKey.set(key, existingIndex);
      continue;
    }
    const nextIndex = result.length;
    result.push(attachment);
    for (const key of keys) indexByKey.set(key, nextIndex);
  }
  return result.length ? result : undefined;
}

export function normalizeWireAttachments(raw: unknown): MessageAttachment[] | undefined {
  if (!Array.isArray(raw)) return undefined;
  return dedupeAttachments(
    raw.map(normalizeAttachment).filter((item): item is MessageAttachment => item !== null),
  );
}

export function mergeWireAttachments(...sources: unknown[]): MessageAttachment[] | undefined {
  return dedupeAttachments(sources.flatMap((source) => normalizeWireAttachments(source) ?? []));
}
