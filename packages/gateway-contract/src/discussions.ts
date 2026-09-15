/** Shared limits for durable meeting capture and import. */
export const DISCUSSION_MAX_DURATION_MS = 120 * 60 * 1_000;
export const DISCUSSION_AUDIO_MAX_BYTES = 1024 * 1024 * 1024;
export const DISCUSSION_CHUNK_MAX_BYTES = 8 * 1024 * 1024;
export const DISCUSSION_SEGMENT_MAX_BYTES = 2 * 1024 * 1024;
export interface DiscussionRecordingChunk { sequence: number; sha256: string; bytes: number }

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

export interface DiscussionFact {
  id: string;
  text: string;
  evidenceSegmentIds: number[];
  evidenceRevision?: number;
  editedByUser?: boolean;
  ignored?: boolean;
  supersededBy?: string;
  disputedBy?: string;
  reviewedChangeId?: string;
}

export interface DiscussionChapter {
  title: string;
  summary: string;
  startedAtMs: number;
  endedAtMs: number;
}

export type DiscussionTemplate = 'general' | 'project' | 'review' | 'interview';

export interface DiscussionActionItem {
  id: string;
  title: string;
  owner?: string;
  dueDate?: string;
  evidenceSegmentIds: number[];
  evidenceRevision?: number;
  editedByUser?: boolean;
  ignored?: boolean;
  supersededBy?: string;
  disputedBy?: string;
  reviewedChangeId?: string;
}

export interface DiscussionOrganization {
  title: string;
  summary: string;
  summaryEditedByUser?: boolean;
  changes?: Array<{ fromId: string; toId: string; relation: 'supersedes' | 'contradicts' }>;
  keyPoints: string[];
  decisions: DiscussionFact[];
  actionItems: DiscussionActionItem[];
  risks: DiscussionFact[];
  openQuestions: DiscussionFact[];
  chapters: DiscussionChapter[];
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
  template?: DiscussionTemplate;
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
  transcriptRevision: number;
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
  totalSegments: number;
  failedSegments: number;
  retriedSegments: number;
  averageSegmentLatencyMs: number | null;
}

