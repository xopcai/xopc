import { apiFetch, fetchJson } from '@/lib/fetch';
import { apiUrl } from '@/lib/url';

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
  kind: NoteKind;
  status: NoteStatus;
  createdAt: number;
  updatedAt: number;
  pinned?: boolean;
  tags?: string[];
  snippet?: string;
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
