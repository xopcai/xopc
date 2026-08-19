export const DISCUSSION_STATUSES = [
  'recording',
  'stopping',
  'sealing',
  'organizing',
  'completed',
  'needs_attention',
  'cancelled',
] as const;

export type DiscussionStatus = typeof DISCUSSION_STATUSES[number];
export type DiscussionSource = 'web' | 'electron';
export type DiscussionProjectInferenceSource = 'context' | 'exact_name' | 'model';
export type DiscussionFailureStage =
  | 'segment_upload'
  | 'segment_transcription'
  | 'audio_upload'
  | 'transcript_sealing'
  | 'organization';

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
  durationMs?: number;
  expectedLastSequence?: number;
  mimeType?: string;
  audioSizeBytes?: number;
  audioSha256?: string;
  canonicalTranscript?: string;
  canonicalTranscriptSha256?: string;
  transcriptLanguage?: string;
  transcriptRevision: number;
  generatedTitle?: string;
  projectInferenceScore?: number;
  projectInferenceSource?: DiscussionProjectInferenceSource;
  failureStage?: DiscussionFailureStage;
  failureCode?: string;
  failureMessage?: string;
  recordingStartedAt: number;
  recordingStoppedAt?: number;
  createdAt: number;
  updatedAt: number;
  completedAt?: number;
  audioDeletedAt?: number;
}

export type DiscussionTranscriptSegmentStatus = 'uploaded' | 'transcribing' | 'confirmed' | 'failed';

export interface DiscussionTranscriptSegment {
  discussionId: string;
  sequence: number;
  audioSha256: string;
  startedAtMs: number;
  endedAtMs: number;
  status: DiscussionTranscriptSegmentStatus;
  rawText?: string;
  displayText?: string;
  language?: string;
  provider?: string;
  confidence?: number;
  speakerLabel?: string;
  revision: number;
  correctedByUser: boolean;
  correctedAt?: number;
  attemptCount: number;
  nextAttemptAt?: number;
  leaseOwner?: string;
  leaseExpiresAt?: number;
  lastError?: string;
  createdAt: number;
  updatedAt: number;
}

export interface DiscussionTranscriptStats {
  expected?: number;
  uploaded: number;
  transcribing: number;
  confirmed: number;
  failed: number;
}

export interface DiscussionTranscript {
  discussionId: string;
  revision: number;
  segments: DiscussionTranscriptSegment[];
  text: string;
  stats: DiscussionTranscriptStats;
}

export interface DiscussionOrganizationRecord {
  id: string;
  discussionId: string;
  revision: number;
  inputTranscriptSha256: string;
  promptVersion: string;
  modelRef: string;
  organization?: DiscussionOrganization;
  status: 'running' | 'completed' | 'failed';
  errorMessage?: string;
  createdAt: number;
  completedAt?: number;
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
  transcript: DiscussionTranscript;
  organization?: DiscussionOrganizationRecord;
}
