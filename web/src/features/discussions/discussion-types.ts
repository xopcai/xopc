import type { Note } from '@/features/notes/notes-api';

export type DiscussionStatus =
  | 'recording'
  | 'stopping'
  | 'sealing'
  | 'organizing'
  | 'completed'
  | 'needs_attention'
  | 'cancelled';

export interface DiscussionActionItem {
  id: string;
  title: string;
  owner?: string;
  dueDate?: string;
  evidenceSegmentIds?: number[];
}

export interface DiscussionOrganization {
  title: string;
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
  source: 'web' | 'electron';
  status: DiscussionStatus;
  durationMs?: number;
  expectedLastSequence?: number;
  canonicalTranscript?: string;
  transcriptLanguage?: string;
  transcriptRevision: number;
  generatedTitle?: string;
  projectInferenceSource?: 'context' | 'exact_name' | 'model';
  failureStage?: string;
  failureCode?: string;
  failureMessage?: string;
  recordingStartedAt: number;
  recordingStoppedAt?: number;
  createdAt: number;
  updatedAt: number;
  completedAt?: number;
}

export interface DiscussionTranscriptSegment {
  discussionId: string;
  sequence: number;
  audioSha256: string;
  startedAtMs: number;
  endedAtMs: number;
  status: 'uploaded' | 'transcribing' | 'confirmed' | 'failed';
  rawText?: string;
  displayText?: string;
  provider?: string;
  revision: number;
  correctedByUser: boolean;
  attemptCount: number;
  lastError?: string;
  createdAt: number;
  updatedAt: number;
}

export interface DiscussionTranscript {
  discussionId: string;
  revision: number;
  segments: DiscussionTranscriptSegment[];
  text: string;
  stats: {
    expected?: number;
    uploaded: number;
    transcribing: number;
    confirmed: number;
    failed: number;
  };
}

export interface DiscussionOrganizationRecord {
  id: string;
  revision: number;
  status: 'running' | 'completed' | 'failed';
  organization?: DiscussionOrganization;
  errorMessage?: string;
}

export interface DiscussionDetail {
  discussion: DiscussionCapture;
  note: Note;
  transcript: DiscussionTranscript;
  organization?: DiscussionOrganizationRecord;
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
