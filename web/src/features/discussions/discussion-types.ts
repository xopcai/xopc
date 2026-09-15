import type { Note } from '@/features/notes/notes-api';

export type { DiscussionStatus, DiscussionSource, DiscussionProjectInferenceSource, DiscussionFailureStage, DiscussionFact, DiscussionChapter, DiscussionTemplate, DiscussionActionItem, DiscussionOrganization, DiscussionCapture, DiscussionTranscriptSegmentStatus, DiscussionTranscriptSegment, DiscussionTranscriptStats, DiscussionTranscript, DiscussionOrganizationRecord, DiscussionCaptureSettings, CreateDiscussionInput, ListDiscussionsQuery, DiscussionListResult, DiscussionMetrics } from '@xopcai/gateway-contract';
import type { DiscussionCapture, DiscussionTranscript, DiscussionOrganizationRecord } from '@xopcai/gateway-contract';
export interface DiscussionDetail { discussion: DiscussionCapture; note: Note; transcript: DiscussionTranscript; organization?: DiscussionOrganizationRecord; recordingJob?: import('@xopcai/gateway-contract').DiscussionRecordingJob }

export interface DiscussionDraft {
  id: string;
  projectId?: string;
  serverDiscussionId?: string;
  fileName?: string;
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
