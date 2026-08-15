export const DISCUSSION_STATUSES = [
  'awaiting_upload',
  'queued',
  'transcribing',
  'analyzing',
  'review_required',
  'completed',
  'failed',
  'cancelled',
] as const;

export type DiscussionStatus = typeof DISCUSSION_STATUSES[number];
export type DiscussionCaptureMode = 'solo' | 'conversation';
export type DiscussionFailedStage = 'transcription' | 'analysis';

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
  failedStage?: DiscussionFailedStage;
  captureMode: DiscussionCaptureMode;
  consentConfirmed: boolean;
  languageHint?: string;
  durationMs?: number;
  mimeType?: string;
  audioSizeBytes?: number;
  audioSha256?: string;
  transcriptRaw?: string;
  transcriptSha256?: string;
  transcriptLanguage?: string;
  sttProvider?: string;
  analysis?: unknown;
  analysisVersion: number;
  analysisInputHash?: string;
  analyzerModelRef?: string;
  review?: unknown;
  reviewRevision: number;
  attemptCount: number;
  nextAttemptAt?: number;
  leaseOwner?: string;
  leaseExpiresAt?: number;
  lastErrorCode?: string;
  lastErrorMessage?: string;
  createdAt: number;
  updatedAt: number;
  completedAt?: number;
  reviewedAt?: number;
  audioDeletedAt?: number;
}

export interface CreateDiscussionInput {
  clientRequestId: string;
  projectId?: string;
  title?: string;
  language?: string;
  captureMode: DiscussionCaptureMode;
  consentConfirmed: boolean;
  source: 'web' | 'electron';
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
  averageTimeToReviewMs: number | null;
  averageTimeToCompleteMs: number | null;
}

export interface DiscussionDetail {
  discussion: DiscussionCapture;
  note: import('../notes/types.js').Note;
}

export interface DiscussionCompletion extends DiscussionDetail {
  createdWorkItemIds: string[];
}
