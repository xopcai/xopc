export const DISCUSSION_STATUSES = [
  'recording',
  'finalizing',
  'completed',
  'failed',
  'cancelled',
] as const;

export type DiscussionStatus = typeof DISCUSSION_STATUSES[number];
export type DiscussionProcessingStage =
  | 'original_upload'
  | 'final_transcription'
  | 'analysis'
  | 'note_write';
export type DiscussionSource = 'web' | 'electron';
export type DiscussionProjectInferenceSource = 'context' | 'exact_name' | 'model';

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
  source: DiscussionSource;
  status: DiscussionStatus;
  processingStage?: DiscussionProcessingStage;
  durationMs?: number;
  expectedLastSequence?: number;
  mimeType?: string;
  audioSizeBytes?: number;
  audioSha256?: string;
  transcriptRaw?: string;
  transcriptSha256?: string;
  transcriptLanguage?: string;
  sttProvider?: string;
  analysis?: DiscussionAnalysis;
  analysisInputHash?: string;
  analyzerModelRef?: string;
  generatedTitle?: string;
  projectInferenceScore?: number;
  projectInferenceSource?: DiscussionProjectInferenceSource;
  finalizationRevision: number;
  attemptCount: number;
  nextAttemptAt?: number;
  leaseOwner?: string;
  leaseExpiresAt?: number;
  lastErrorCode?: string;
  lastErrorMessage?: string;
  recordingStartedAt: number;
  recordingFinishedAt?: number;
  createdAt: number;
  updatedAt: number;
  completedAt?: number;
  audioDeletedAt?: number;
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
  nextAttemptAt?: number;
  leaseOwner?: string;
  leaseExpiresAt?: number;
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

export interface CreateDiscussionInput {
  clientRequestId: string;
  contextProjectId?: string;
  consentPolicyVersion: number;
  source: DiscussionSource;
}

export interface ListDiscussionsQuery {
  status?: DiscussionStatus | 'active';
  projectId?: string;
  limit?: number;
  offset?: number;
}

export interface DiscussionListResult {
  items: DiscussionCapture[];
  total: number;
  limit: number;
  offset: number;
  hasMore: boolean;
}

export interface DiscussionMetrics {
  total: number;
  byStatus: Record<DiscussionStatus, number>;
  averageTimeToFirstTranscriptMs: number | null;
  averageTimeToCompleteMs: number | null;
}

export interface DiscussionDetail {
  discussion: DiscussionCapture;
  note: import('../notes/types.js').Note;
}
