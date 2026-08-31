import { apiFetch, fetchJson } from '@/lib/fetch';
import { apiUrl } from '@/lib/url';

import {
  formatVoiceMemoLabel,
  noteAttachmentRef,
  postNoteFormData,
} from './note-media';

export type NoteKind = 'thought' | 'todo' | 'voice' | 'media' | 'bookmark' | 'mixed' | 'task';
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

export interface NoteCatalysisAction {
  text: string;
  kind: 'task' | 'workflow' | 'research' | 'share' | 'chat';
}

export interface NoteCatalysisReport {
  originalNoteId: string;
  generatedAt: number;
  title: string;
  valueHypothesis: string;
  targetUsers: string[];
  keyQuestions: string[];
  mvpPath: string[];
  risks: string[];
  nextActions: NoteCatalysisAction[];
  confidence: number;
}

export interface NoteAgentContextAttachmentStatus {
  attachmentId: string;
  type: NoteAttachment['type'];
  fileName: string;
  mimeType: string;
  size: number;
  status: 'ready' | 'unsupported' | 'failed';
  summary?: string;
  transcript?: string;
  extractedText?: string;
  error?: string;
}

export interface NoteAgentContextStatus {
  noteUpdatedAt: number;
  stale: boolean;
  status: 'ready' | 'partial' | 'failed';
  generatedAt?: number;
  tokenEstimate?: number;
  truncated: boolean;
  attachments: NoteAgentContextAttachmentStatus[];
}

export interface NoteCatalysisMeta {
  status: 'none' | 'queued' | 'catalyzed' | 'snoozed' | 'dismissed';
  stage?: 'seed' | 'incubating' | 'developing' | 'validating' | 'shipped';
  lastCatalyzedAt?: number;
  nextCatalyzeAt?: number;
  feedback?: 'helpful' | 'not_helpful' | 'neutral';
  confidence?: number;
  report?: NoteCatalysisReport;
  reportNoteId?: string;
  sourceSessionKey?: string;
  linkedSessionKeys?: string[];
  linkedWorkflowRunIds?: string[];
  linkedShareIds?: string[];
}

export interface NoteAiDeepMeta {
  processedAt: number;
  priority?: 'high' | 'medium' | 'low';
  relatedNoteIds?: string[];
  insights?: string;
  catalysis?: NoteCatalysisMeta;
}

export interface Note {
  id: string;
  title?: string;
  kind: NoteKind;
  status: NoteStatus;
  markdown: string;
  attachments?: NoteAttachment[];
  createdAt: number;
  updatedAt: number;
  capturedVia: { channel: string; platform?: string };
  ai?: NoteAiMeta;
  aiDeep?: NoteAiDeepMeta;
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
  projectId?: string;
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
  if (query.projectId) params.set('projectId', query.projectId);
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

export async function createNote(input: {
  markdown: string;
  title?: string;
  kind?: NoteKind;
  tags?: string[];
  projectId?: string;
  pinned?: boolean;
  channel?: string;
}): Promise<Note> {
  const result = await fetchJson<{ note: Note }>(apiUrl('/api/notes'), {
    method: 'POST',
    body: JSON.stringify({
      markdown: input.markdown,
      title: input.title,
      kind: input.kind,
      tags: input.tags,
      projectId: input.projectId,
      pinned: input.pinned,
      channel: input.channel ?? 'web',
    }),
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

export interface NoteShareItem {
  id: string;
  kind: 'note';
  fileName: string;
  shareUrl: string;
  lanUrl: string | null;
  reachability: 'public' | 'lan' | 'local-only';
  reachabilityHint: string | null;
  createdAt: string;
  expiresAt: string;
  viewCount: number;
  maxViews: number | null;
  revoked: boolean;
  expired: boolean;
  description: string | null;
  sourceVersion: number;
  snapshotRevision: number;
  attachmentCount: number;
  stale: boolean;
}

export interface CreateNoteShareInput {
  expectedNoteVersion: number;
  attachmentIds?: string[];
  ttlMs?: number;
  maxViews?: number | null;
  description?: string;
}

export async function listNoteShares(id: string): Promise<{ items: NoteShareItem[]; total: number; noteVersion: number }> {
  return fetchJson(apiUrl(`/api/notes/${encodeURIComponent(id)}/shares`));
}

export async function createNoteShare(id: string, input: CreateNoteShareInput): Promise<{
  ok: true;
  payload: {
    id: string;
    kind: 'note';
    shareUrl: string;
    lanUrl: string | null;
    reachability: NoteShareItem['reachability'];
    reachabilityHint: string | null;
    expiresAt: string;
    maxViews: number | null;
    sourceNoteId: string;
    sourceVersion: number;
    snapshotRevision: number;
    attachmentCount: number;
    fileName: string;
  };
}> {
  return fetchJson(apiUrl(`/api/notes/${encodeURIComponent(id)}/shares`), {
    method: 'POST',
    body: JSON.stringify(input),
  });
}

export async function refreshNoteShare(id: string, shareId: string, input: Pick<CreateNoteShareInput, 'expectedNoteVersion' | 'attachmentIds'>): Promise<void> {
  await fetchJson(apiUrl(`/api/notes/${encodeURIComponent(id)}/shares/${encodeURIComponent(shareId)}/refresh`), {
    method: 'POST',
    body: JSON.stringify(input),
  });
}

export async function catalyzeNote(id: string): Promise<{ note: Note; report: NoteCatalysisReport }> {
  return fetchJson<{ note: Note; report: NoteCatalysisReport }>(
    apiUrl(`/api/notes/${encodeURIComponent(id)}/catalyze`),
    { method: 'POST' },
  );
}

export async function recordNoteCatalysisFeedback(
  id: string,
  feedback: 'helpful' | 'not_helpful' | 'neutral',
): Promise<Note> {
  const result = await fetchJson<{ note: Note }>(
    apiUrl(`/api/notes/${encodeURIComponent(id)}/catalysis-feedback`),
    {
      method: 'POST',
      body: JSON.stringify({ feedback }),
    },
  );
  return result.note;
}

export interface NoteChatSessionSummary {
  key: string;
  name?: string;
  updatedAt?: string;
  messageCount?: number;
  customData?: Record<string, unknown>;
}

export interface NoteSourceBinding {
  kind: 'note';
  sourceId: string;
  version: string;
  attachedAt: number;
}

export async function openNoteChat(
  id: string,
  opts: { forceNew?: boolean } = {},
): Promise<{ sessionKey: string; reused: boolean; session?: NoteChatSessionSummary; sourceBinding?: NoteSourceBinding }> {
  return fetchJson<{ sessionKey: string; reused: boolean; session?: NoteChatSessionSummary; sourceBinding?: NoteSourceBinding }>(
    apiUrl(`/api/notes/${encodeURIComponent(id)}/chat`),
    {
      method: 'POST',
      body: JSON.stringify(opts.forceNew ? { forceNew: true } : {}),
    },
  );
}

export async function listNoteThreads(id: string): Promise<NoteChatSessionSummary[]> {
  const result = await fetchJson<{ items: NoteChatSessionSummary[]; total: number }>(
    apiUrl(`/api/notes/${encodeURIComponent(id)}/threads`),
  );
  return result.items;
}

export async function getNoteAgentContextStatus(id: string): Promise<NoteAgentContextStatus> {
  return fetchJson<NoteAgentContextStatus>(apiUrl(`/api/notes/${encodeURIComponent(id)}/context-status`));
}

export async function rebuildNoteAgentContext(id: string): Promise<NoteAgentContextStatus> {
  return fetchJson<NoteAgentContextStatus>(apiUrl(`/api/notes/${encodeURIComponent(id)}/context-rebuild`), {
    method: 'POST',
  });
}

export async function appendNoteContent(id: string, content: string, heading?: string): Promise<Note> {
  const result = await fetchJson<{ note: Note }>(apiUrl(`/api/notes/${encodeURIComponent(id)}/append`), {
    method: 'POST',
    body: JSON.stringify({ content, heading }),
  });
  return result.note;
}

export async function createTaskNote(
  title: string,
  opts: { sourceSessionKey?: string | null; sourceNoteId?: string | null; priority?: 'high' | 'medium' | 'low' } = {},
): Promise<Note> {
  const result = await fetchJson<{ note: Note }>(apiUrl('/api/notes/task'), {
    method: 'POST',
    body: JSON.stringify({
      title,
      channel: 'web',
      priority: opts.priority,
      sourceSessionKey: opts.sourceSessionKey || undefined,
      sourceNoteId: opts.sourceNoteId || undefined,
    }),
  });
  return result.note;
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
  opts?: { markdown?: string; channel?: string; kind?: NoteKind; duration?: number },
): Promise<Note> {
  const form = new FormData();
  form.append('file', file);
  if (opts?.markdown) {
    form.append('markdown', opts.markdown);
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

  const markdown = `![${attachment.fileName}](${noteAttachmentRef(note.id, attachment.id)})`;
  if (note.markdown !== markdown) {
    note = await updateNote(note.id, { markdown });
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
  const markdown = `[${label}](${noteAttachmentRef(note.id, attachment.id)})`;
  if (note.markdown !== markdown) {
    note = await updateNote(note.id, { markdown, kind: 'voice' });
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
  markdown: string;
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
