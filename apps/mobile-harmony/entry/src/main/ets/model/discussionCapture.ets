export type XopcDiscussionCapturePhase = 'idle' | 'starting' | 'recording' | 'paused' | 'stopping' | 'organizing' | 'completed' | 'error';

export interface XopcDiscussionCaptureSettings {
  consentPolicyVersion: number;
  consentAcknowledgedAt?: number;
}

export interface XopcDiscussionCaptureSummary {
  id: string;
  noteId: string;
  status: string;
  durationMs?: number;
  audioAttachmentId?: string;
  audioDeletedAt?: number;
  clientRequestId?: string;
  canonicalTranscript?: string;
  transcriptRevision?: number;
  template?: string;
  failureStage?: string;
  failureMessage?: string;
}

export interface XopcDiscussionTranscriptSegment {
  sequence: number;
  status: string;
  startedAtMs: number;
  endedAtMs: number;
  displayText?: string;
  rawText?: string;
  speakerLabel?: string;
}

export interface XopcDiscussionFact { evidenceSegmentIds?: number[]; evidenceRevision?: number; id: string; text: string; ignored?: boolean; }
export interface XopcDiscussionActionItem { evidenceSegmentIds?: number[]; evidenceRevision?: number; id: string; title: string; owner?: string; dueDate?: string; ignored?: boolean; }
export interface XopcDiscussionOrganization {
  summary: string;
  keyPoints: string[];
  keyPointEvidence?: XopcDiscussionFact[];
  summaryEvidenceSegmentIds?: number[];
  decisions: XopcDiscussionFact[];
  actionItems: XopcDiscussionActionItem[];
  risks: XopcDiscussionFact[];
  openQuestions: XopcDiscussionFact[];
}

export interface XopcDiscussionOrganizationRecord {
  transcriptRevision?: number;
  organization?: XopcDiscussionOrganization;
  status: string;
  errorMessage?: string;
}

export interface XopcDiscussionRecordingJob { state: string; error?: string; }

export interface XopcDiscussionTranscript {
  discussionId: string;
  revision: number;
  segments: XopcDiscussionTranscriptSegment[];
  text: string;
}

export interface XopcDiscussionProcessingProgress {
  fromAudio: boolean;
  completedChunks: number;
  transcribedMs: number;
  attemptCount: number;
  maxAttempts: number;
  nextAttemptAt?: number;
}

export interface XopcDiscussionDetail {
  discussion: XopcDiscussionCaptureSummary;
  transcript: XopcDiscussionTranscript;
  organization?: XopcDiscussionOrganizationRecord;
  recordingJob?: XopcDiscussionRecordingJob;
  processing?: XopcDiscussionProcessingProgress;
}

export interface XopcDiscussionRecordingManifest {
  lastSequence: number;
  chunkCount: number;
  mimeType: string;
  fileName: string;
  containerMode: 'independent_wav';
  events?: XopcDiscussionRecordingEvent[];
}

export interface XopcDiscussionRecordingEvent { recordedAt: number; kind: string; savedMs: number; }

export interface XopcAnnotationAnchor {
  type: string;
  capturedAt: number;
  epoch?: number;
  coordinate?: string;
  offsetMs?: number;
  positionMs?: number;
  transcriptRevision?: number;
  segmentIds?: number[];
}
export interface XopcDiscussionAnnotation {
  id: string; kind: string; text: string; anchor: XopcAnnotationAnchor; revision: number;
  deleted: boolean; createdAt: number; updatedAt: number;
}
export interface XopcAnnotationInput {
  id: string; kind: string; text: string; anchor: XopcAnnotationAnchor; expectedRevision: number; deleted: boolean;
}
export interface XopcPlaybackRange { startedAtMs: number; endedAtMs: number; }
export interface XopcEvidenceSegment {
  sequence: number; startedAtMs: number; endedAtMs: number; text: string; speakerLabel?: string; playback: XopcPlaybackRange[];
}
export interface XopcDiscussionEvidence {
  transcriptRevision: number; stale: boolean; audioAvailable: boolean; timingVerified: boolean; segments: XopcEvidenceSegment[];
}
export interface XopcResolvedAnnotation {
  annotation: XopcDiscussionAnnotation; state: string; positionMs?: number; playback: XopcPlaybackRange[]; evidence?: XopcDiscussionEvidence;
}

export interface XopcReviewEntry {
  id: string; kind: string; title: string; text: string;
  transcriptRevision?: number; provisional: boolean; stale: boolean;
  startedAtMs?: number; endedAtMs?: number;
  segments: XopcEvidenceSegment[]; playback: XopcPlaybackRange[];
  highlightCount?: number; actionCount?: number;
}
export interface XopcReviewCoverage {
  durationMs: number; audioAvailable: boolean;
  processedMs: number; continuousThroughMs: number;
  analysisRanges: XopcPlaybackRange[]; analysisRevision?: number; analysisStale: boolean; complete: boolean;
}
export interface XopcDiscussionReview {
  version: string; query: string; offset: number; total: number; hasMore: boolean;
  hits: XopcReviewEntry[]; chapters: XopcReviewEntry[]; coverage: XopcReviewCoverage;
}

export interface XopcRecordingPanelActions {
  phase: string;
  captureStatus: string;
  inputConfirmed: boolean;
  recoveryBusy: boolean;
  mark(): Promise<void>;
  togglePause(): void;
  stop(): Promise<string>;
}
