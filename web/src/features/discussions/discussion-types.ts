import type { Note } from '@/features/notes/notes-api';

export type DiscussionStatus = 'recording' | 'finalizing' | 'completed' | 'failed' | 'cancelled';

export interface DiscussionActionItem {
  id: string;
  title: string;
  owner?: string;
  dueDate?: string;
}

export interface DiscussionAnalysis {
  title: string;
  summary: string;
  keyPoints: string[];
  decisions: string[];
  actionItems: DiscussionActionItem[];
  risks: string[];
  openQuestions: string[];
  projectCandidateId?: string;
  projectConfidence?: number;
  projectAlternativeConfidence?: number;
}

export interface DiscussionCapture {
  id: string;
  clientRequestId: string;
  noteId: string;
  projectId?: string;
  audioAttachmentId?: string;
  source: 'web' | 'electron';
  status: DiscussionStatus;
  processingStage?: 'original_upload' | 'final_transcription' | 'analysis' | 'note_write';
  durationMs?: number;
  expectedLastSequence?: number;
  mimeType?: string;
  audioSizeBytes?: number;
  transcriptRaw?: string;
  transcriptLanguage?: string;
  sttProvider?: string;
  analysis?: DiscussionAnalysis;
  generatedTitle?: string;
  projectInferenceScore?: number;
  projectInferenceSource?: 'context' | 'exact_name' | 'model';
  finalizationRevision: number;
  attemptCount: number;
  lastErrorCode?: string;
  lastErrorMessage?: string;
  recordingStartedAt: number;
  recordingFinishedAt?: number;
  createdAt: number;
  updatedAt: number;
  completedAt?: number;
  audioDeletedAt?: number;
}

export interface DiscussionDetail {
  discussion: DiscussionCapture;
  note: Note;
}

export interface DiscussionTranscriptSegment {
  discussionId: string;
  sequence: number;
  audioSha256: string;
  startedAtMs: number;
  endedAtMs: number;
  status: 'uploaded' | 'transcribing' | 'completed' | 'failed';
  transcript?: string;
  provider?: string;
  attemptCount: number;
  lastError?: string;
  createdAt: number;
  updatedAt: number;
}

export interface DiscussionTranscript {
  discussionId: string;
  segments: DiscussionTranscriptSegment[];
  text: string;
}

export interface DiscussionCaptureSettings {
  consentPolicyVersion: number;
  consentAcknowledgedAt?: number;
}

export interface DiscussionDraft {
  id: string;
  projectId?: string;
  serverDiscussionId?: string;
  mimeType: string;
  startedAt: number;
  updatedAt: number;
  durationMs: number;
  chunkCount: number;
  lastSequence: number;
  state: 'recording' | 'stopped' | 'upload_failed';
}

export interface DiscussionDraftChunk {
  draftId: string;
  index: number;
  blob: Blob;
  createdAt: number;
}

export interface DiscussionLiveSegment {
  draftId: string;
  sequence: number;
  blob: Blob;
  startedAtMs: number;
  endedAtMs: number;
  sha256: string;
  createdAt: number;
}
