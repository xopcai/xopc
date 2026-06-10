import { apiFetch, fetchJson } from '@/lib/fetch';
import { apiUrl } from '@/lib/url';

import {
  formatVoiceMemoLabel,
  noteAttachmentRef,
  postNoteFormData,
} from './note-media';

export type NoteKind = 'thought' | 'todo' | 'voice' | 'media' | 'bookmark' | 'mixed';
export type NoteStatus = 'inbox' | 'processed' | 'archived' | 'trashed';

export interface NoteAttachment {
  id: string;
  type: 'image' | 'video' | 'audio' | 'file';
  mimeType: string;
  fileName: string;
  size: number;
  relativePath: string;
  transcript?: string;
  duration?: number;
}

export interface NoteAiMeta {
  summary?: string;
  intent?: 'action_item' | 'idea' | 'reference' | 'question' | 'log';
  extractedTodos?: Array<{ text: string; deadline?: string; done: boolean }>;
  suggestedTags?: string[];
}

export interface Note {
  id: string;
  title?: string;
  kind: NoteKind;
  status: NoteStatus;
  text?: string;
  attachments?: NoteAttachment[];
  createdAt: number;
  updatedAt: number;
  capturedVia: { channel: string; platform?: string };
  ai?: NoteAiMeta;
  tags?: string[];
  pinned?: boolean;
}

export interface NoteIndexEntry {
  id: string;
  title?: string;
  kind: NoteKind;
  status: NoteStatus;
  createdAt: number;
  updatedAt: number;
  pinned?: boolean;
  tags?: string[];
  snippet?: string;
  coverAttachmentId?: string;
  voiceAttachmentId?: string;
  voiceDurationSec?: number;
  attachmentNames?: string[];
}

export interface NotesListQuery {
  status?: NoteStatus;
  kind?: NoteKind;
  tag?: string;
  pinned?: boolean;
  search?: string;
  limit?: number;
  offset?: number;
  sortBy?: 'createdAt' | 'updatedAt';
  sortOrder?: 'asc' | 'desc';
}

export async function listNotes(query: NotesListQuery = {}): Promise<{ items: NoteIndexEntry[]; total: number }> {
  const params = new URLSearchParams();
  if (query.status) params.set('status', query.status);
  if (query.kind) params.set('kind', query.kind);
  if (query.tag) params.set('tag', query.tag);
  if (query.pinned !== undefined) params.set('pinned', String(query.pinned));
  if (query.search) params.set('search', query.search);
  if (query.limit) params.set('limit', String(query.limit));
  if (query.offset) params.set('offset', String(query.offset));
  if (query.sortBy) params.set('sortBy', query.sortBy);
  if (query.sortOrder) params.set('sortOrder', query.sortOrder);
  const qs = params.toString();
  const url = apiUrl(`/api/notes${qs ? `?${qs}` : ''}`);
  return fetchJson<{ items: NoteIndexEntry[]; total: number }>(url);
}

export async function quickCapture(text: string, channel = 'web'): Promise<Note> {
  const result = await fetchJson<{ note: Note }>(apiUrl('/api/notes/quick-capture'), {
    method: 'POST',
    body: JSON.stringify({ text, channel }),
  });
  return result.note;
}

export async function getNote(id: string): Promise<Note | null> {
  const res = await apiFetch(apiUrl(`/api/notes/${encodeURIComponent(id)}`));
  if (res.status === 404) return null;
  const data = (await res.json()) as { note?: Note; error?: string };
  if (!res.ok) throw new Error(data.error || `HTTP ${res.status}`);
  return data.note ?? null;
}

export async function updateNote(id: string, patch: Partial<Note>): Promise<Note> {
  const result = await fetchJson<{ note: Note }>(apiUrl(`/api/notes/${encodeURIComponent(id)}`), {
    method: 'PATCH',
    body: JSON.stringify(patch),
  });
  return result.note;
}

export async function deleteNote(id: string): Promise<void> {
  await fetchJson(apiUrl(`/api/notes/${encodeURIComponent(id)}`), { method: 'DELETE' });
}

export async function uploadNoteMedia(noteId: string, file: File): Promise<NoteAttachment> {
  const form = new FormData();
  form.append('file', file);
  const result = await postNoteFormData<{ attachment: NoteAttachment }>(
    apiUrl(`/api/notes/${encodeURIComponent(noteId)}/media`),
    form,
  );
  return result.attachment;
}

export async function createNoteWithMedia(
  file: File,
  opts?: { text?: string; channel?: string; kind?: NoteKind; duration?: number },
): Promise<Note> {
  const form = new FormData();
  form.append('file', file);
  if (opts?.text) {
    form.append('text', opts.text);
  }
  form.append('channel', opts?.channel ?? 'web');
  if (opts?.kind) {
    form.append('kind', opts.kind);
  }
  if (opts?.duration !== undefined) {
    form.append('duration', String(opts.duration));
  }
  const result = await postNoteFormData<{ note: Note }>(apiUrl('/api/notes'), form);
  return result.note;
}

/** Create a media note from an image file and embed markdown reference. */
export async function quickCaptureImage(file: File, channel = 'web'): Promise<Note> {
  let note = await createNoteWithMedia(file, { channel });
  const attachment = note.attachments?.find((a) => a.type === 'image') ?? note.attachments?.[0];
  if (!attachment) return note;

  const text = `![${attachment.fileName}](${noteAttachmentRef(note.id, attachment.id)})`;
  if (note.text !== text) {
    note = await updateNote(note.id, { text });
  }
  return note;
}

/** Create a voice note from an audio recording and embed a markdown link reference. */
export async function quickCaptureVoice(
  file: File,
  durationSec: number,
  channel = 'web',
): Promise<Note> {
  let note = await createNoteWithMedia(file, { channel, kind: 'voice', duration: durationSec });
  const attachment = note.attachments?.find((a) => a.type === 'audio') ?? note.attachments?.[0];
  if (!attachment) return note;

  const label = formatVoiceMemoLabel(durationSec);
  const text = `[${label}](${noteAttachmentRef(note.id, attachment.id)})`;
  if (note.text !== text) {
    note = await updateNote(note.id, { text, kind: 'voice' });
  }
  return note;
}

export type SnapshotTrigger = 'edit' | 'ai_edit' | 'sync' | 'restore';

export interface NoteSnapshotEntry {
  timestamp: number;
  trigger: SnapshotTrigger;
  snippet?: string;
}

export interface NoteSnapshot {
  noteId: string;
  timestamp: number;
  trigger: SnapshotTrigger;
  title?: string;
  text?: string;
  tags?: string[];
  kind: NoteKind;
  status: NoteStatus;
}

export async function listNoteHistory(noteId: string): Promise<NoteSnapshotEntry[]> {
  const result = await fetchJson<{ entries: NoteSnapshotEntry[] }>(
    apiUrl(`/api/notes/${encodeURIComponent(noteId)}/history`),
  );
  return result.entries;
}

export async function getNoteSnapshot(noteId: string, timestamp: number): Promise<NoteSnapshot> {
  const result = await fetchJson<{ snapshot: NoteSnapshot }>(
    apiUrl(`/api/notes/${encodeURIComponent(noteId)}/history/${timestamp}`),
  );
  return result.snapshot;
}

export async function restoreNoteSnapshot(noteId: string, timestamp: number): Promise<Note> {
  const result = await fetchJson<{ note: Note }>(
    apiUrl(`/api/notes/${encodeURIComponent(noteId)}/history/restore`),
    {
      method: 'POST',
      body: JSON.stringify({ timestamp }),
    },
  );
  return result.note;
}

export { noteAttachmentRef, formatVoiceMemoLabel } from './note-media';
export { buildNoteAttachmentRef, parseNoteAttachmentTarget, noteMediaApiPath } from './attachment-ref';
export { AuthenticatedImage } from './authenticated-image';
export { NoteMarkdownView } from './note-markdown-view';
