import type { Note } from '@/features/notes/notes-api';

export type DiscussionStatus =
  | 'awaiting_upload'
  | 'queued'
  | 'transcribing'
  | 'analyzing'
  | 'review_required'
  | 'completed'
  | 'failed'
  | 'cancelled';

export interface DiscussionActionItem {
  id: string;
  title: string;
  owner?: string;
  dueDate?: string;
}

export interface DiscussionAnalysis {
  summary: string;
  keyPoints: string[];
  decisions: string[];
  actionItems: DiscussionActionItem[];
  risks: string[];
  openQuestions: string[];
}

export interface DiscussionCapture {
  id: string;
  clientRequestId: string;
  noteId: string;
  projectId?: string;
  audioAttachmentId?: string;
  status: DiscussionStatus;
  captureMode: 'solo' | 'conversation';
  consentConfirmed: boolean;
  languageHint?: string;
  durationMs?: number;
  mimeType?: string;
  audioSizeBytes?: number;
  lastErrorCode?: string;
  lastErrorMessage?: string;
  analysis?: DiscussionAnalysis;
  review?: DiscussionAnalysis;
  analysisVersion: number;
  reviewRevision: number;
  createdAt: number;
  updatedAt: number;
  audioDeletedAt?: number;
}

export interface DiscussionDetail {
  discussion: DiscussionCapture;
  note: Note;
}

export interface DiscussionCompletion extends DiscussionDetail {
  createdWorkItemIds: string[];
}

export interface DiscussionDraft {
  id: string;
  projectId?: string;
  title?: string;
  language: string;
  captureMode: 'solo' | 'conversation';
  consentConfirmed: boolean;
  mimeType: string;
  startedAt: number;
  updatedAt: number;
  durationMs: number;
  chunkCount: number;
  state: 'recording' | 'stopped' | 'upload_failed';
  serverDiscussionId?: string;
}

export interface DiscussionDraftChunk {
  draftId: string;
  index: number;
  blob: Blob;
  createdAt: number;
}
