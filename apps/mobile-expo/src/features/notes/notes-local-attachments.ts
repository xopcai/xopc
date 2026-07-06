import { storage } from '../../storage/mmkv';
import { uploadNoteMedia, type NoteAttachment } from '../../query/notes';
import type { ComposerAttachment } from '../chat/composer.types';

const LOCAL_ATTACHMENT_PREFIX = 'notes:local:attachment:';
const LOCAL_ATTACHMENT_IDS_PREFIX = 'notes:local:attachment-ids:';
const LOCAL_ATTACHMENT_SCHEME = 'xopc-local-attachment://';

export interface LocalNoteAttachment {
  id: string;
  noteId: string;
  type: 'image' | 'document' | 'audio';
  name: string;
  mimeType: string;
  size: number;
  content: string;
  localUri?: string;
  durationMillis?: number;
  transcript?: string;
  createdAt: number;
}

export type PreparedLocalNoteAttachmentUpload = {
  noteId: string;
  localAttachmentId: string;
  localRef: string;
  canonicalRef: string;
  attachment: NoteAttachment;
};

export type PreparedLocalNoteAttachmentMarkdown = {
  markdown: string;
  uploads: PreparedLocalNoteAttachmentUpload[];
};

type LocalNoteAttachmentInput = Pick<
  ComposerAttachment,
  'type' | 'name' | 'mimeType' | 'size' | 'content' | 'localUri' | 'durationSeconds' | 'transcript'
>;

function parseJson<T>(raw: string | undefined): T | null {
  if (!raw) return null;
  try {
    return JSON.parse(raw) as T;
  } catch {
    return null;
  }
}

function localAttachmentKey(noteId: string, attachmentId: string): string {
  return `${LOCAL_ATTACHMENT_PREFIX}${encodeURIComponent(noteId)}:${encodeURIComponent(attachmentId)}`;
}

function localAttachmentIdsKey(noteId: string): string {
  return `${LOCAL_ATTACHMENT_IDS_PREFIX}${encodeURIComponent(noteId)}`;
}

function readLocalAttachmentIds(noteId: string): string[] {
  return parseJson<string[]>(storage.getString(localAttachmentIdsKey(noteId))) ?? [];
}

function writeLocalAttachmentIds(noteId: string, ids: string[]): void {
  storage.set(localAttachmentIdsKey(noteId), JSON.stringify(ids));
}

function createLocalAttachmentId(name: string): string {
  const safeName = name.replace(/[^a-z0-9._-]/gi, '-').replace(/-+/g, '-').slice(0, 40) || 'attachment';
  return `${Date.now().toString(36)}_${safeName}_${Math.random().toString(36).slice(2, 8)}`;
}

function canonicalNoteAttachmentRef(noteId: string, attachmentId: string): string {
  return `xopc-attachment://notes/${encodeURIComponent(noteId)}/${encodeURIComponent(attachmentId)}`;
}

function dataUriFromLocalAttachment(attachment: LocalNoteAttachment): string {
  return `data:${attachment.mimeType || 'application/octet-stream'};base64,${attachment.content.replace(/\s/g, '')}`;
}

function writeLocalNoteAttachment(attachment: LocalNoteAttachment): void {
  storage.set(localAttachmentKey(attachment.noteId, attachment.id), JSON.stringify(attachment));
  const ids = readLocalAttachmentIds(attachment.noteId);
  if (!ids.includes(attachment.id)) {
    writeLocalAttachmentIds(attachment.noteId, [...ids, attachment.id]);
  }
}

function deleteLocalNoteAttachment(noteId: string, attachmentId: string): void {
  storage.delete(localAttachmentKey(noteId, attachmentId));
  writeLocalAttachmentIds(noteId, readLocalAttachmentIds(noteId).filter((id) => id !== attachmentId));
}

export function localNoteAttachmentRef(noteId: string, attachmentId: string): string {
  return `${LOCAL_ATTACHMENT_SCHEME}notes/${encodeURIComponent(noteId)}/${encodeURIComponent(attachmentId)}`;
}

export function parseLocalNoteAttachmentRef(src: string): { noteId: string; attachmentId: string } | null {
  const match = /^xopc-local-attachment:\/\/notes\/([^/\s)]+)\/([^\s)]+)$/.exec(src.trim());
  if (!match) return null;
  return {
    noteId: decodeURIComponent(match[1]),
    attachmentId: decodeURIComponent(match[2]),
  };
}

export function isLocalNoteAttachmentRef(src: string): boolean {
  return src.startsWith(LOCAL_ATTACHMENT_SCHEME);
}

export function readLocalNoteAttachment(noteId: string, attachmentId: string): LocalNoteAttachment | null {
  return parseJson<LocalNoteAttachment>(storage.getString(localAttachmentKey(noteId, attachmentId)));
}

export function createLocalNoteAttachment(
  noteId: string,
  input: LocalNoteAttachmentInput,
): { attachment: LocalNoteAttachment; src: string; displaySrc?: string } {
  const id = createLocalAttachmentId(input.name);
  const attachment: LocalNoteAttachment = {
    id,
    noteId,
    type: input.type,
    name: input.name,
    mimeType: input.mimeType,
    size: input.size,
    content: input.content.replace(/\s/g, ''),
    localUri: input.localUri,
    durationMillis: input.durationSeconds != null ? Math.round(input.durationSeconds * 1000) : undefined,
    transcript: input.transcript,
    createdAt: Date.now(),
  };
  writeLocalNoteAttachment(attachment);
  const src = localNoteAttachmentRef(noteId, id);
  return {
    attachment,
    src,
    displaySrc: attachment.type === 'image' ? dataUriFromLocalAttachment(attachment) : undefined,
  };
}

export function displaySrcForLocalNoteAttachmentRef(src: string): string | undefined {
  const parsed = parseLocalNoteAttachmentRef(src);
  if (!parsed) return undefined;
  const attachment = readLocalNoteAttachment(parsed.noteId, parsed.attachmentId);
  if (!attachment || attachment.type !== 'image') return undefined;
  return dataUriFromLocalAttachment(attachment);
}

export function composerAttachmentFromLocalNoteAttachmentRef(
  src: string,
  alt?: string,
): ComposerAttachment | null {
  const parsed = parseLocalNoteAttachmentRef(src);
  if (!parsed) return null;
  const attachment = readLocalNoteAttachment(parsed.noteId, parsed.attachmentId);
  if (!attachment) return null;
  return {
    id: attachment.id,
    type: attachment.type,
    name: alt?.trim() || attachment.name,
    mimeType: attachment.mimeType,
    size: attachment.size,
    content: attachment.content,
    localUri: attachment.localUri,
    durationSeconds: attachment.durationMillis != null ? Math.max(1, Math.round(attachment.durationMillis / 1000)) : undefined,
    transcript: attachment.transcript,
  };
}

function collectLocalAttachmentRefs(markdown: string): string[] {
  const refs = new Set<string>();
  const refPattern = /xopc-local-attachment:\/\/notes\/([^/\s)]+)\/([^\s)]+)/g;
  for (const match of markdown.matchAll(refPattern)) {
    refs.add(match[0]);
  }
  return [...refs];
}

export async function prepareLocalNoteAttachmentUploadsForMarkdown(
  noteId: string,
  markdown: string,
  options?: { localNoteId?: string },
): Promise<PreparedLocalNoteAttachmentMarkdown> {
  let nextMarkdown = markdown;
  const uploads: PreparedLocalNoteAttachmentUpload[] = [];
  const localNoteId = options?.localNoteId ?? noteId;

  for (const localRef of collectLocalAttachmentRefs(markdown)) {
    const parsed = parseLocalNoteAttachmentRef(localRef);
    if (!parsed || parsed.noteId !== localNoteId) continue;
    const local = readLocalNoteAttachment(parsed.noteId, parsed.attachmentId);
    if (!local) continue;

    const attachment = await uploadNoteMedia(noteId, {
      localUri: local.localUri,
      name: local.name,
      mimeType: local.mimeType,
      content: local.content,
      durationMillis: local.durationMillis,
    });

    const canonicalRef = canonicalNoteAttachmentRef(noteId, attachment.id);
    nextMarkdown = nextMarkdown.split(localRef).join(canonicalRef);
    uploads.push({
      noteId: localNoteId,
      localAttachmentId: local.id,
      localRef,
      canonicalRef,
      attachment,
    });
  }

  return { markdown: nextMarkdown, uploads };
}

export function commitLocalNoteAttachmentUploads(uploads: PreparedLocalNoteAttachmentUpload[]): void {
  for (const upload of uploads) {
    deleteLocalNoteAttachment(upload.noteId, upload.localAttachmentId);
  }
}

export function deleteLocalNoteAttachments(noteId: string): void {
  for (const id of readLocalAttachmentIds(noteId)) {
    storage.delete(localAttachmentKey(noteId, id));
  }
  storage.delete(localAttachmentIdsKey(noteId));
}

export const resetLocalNoteAttachmentsForTests = deleteLocalNoteAttachments;
