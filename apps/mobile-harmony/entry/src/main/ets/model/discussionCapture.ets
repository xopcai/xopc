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

export interface XopcDiscussionFact { id: string; text: string; ignored?: boolean; }
export interface XopcDiscussionActionItem { id: string; title: string; owner?: string; dueDate?: string; ignored?: boolean; }
export interface XopcDiscussionOrganization {
  summary: string;
  keyPoints: string[];
  decisions: XopcDiscussionFact[];
  actionItems: XopcDiscussionActionItem[];
  risks: XopcDiscussionFact[];
  openQuestions: XopcDiscussionFact[];
}

export interface XopcDiscussionOrganizationRecord {
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

export interface XopcDiscussionDetail {
  discussion: XopcDiscussionCaptureSummary;
  transcript: XopcDiscussionTranscript;
  organization?: XopcDiscussionOrganizationRecord;
  recordingJob?: XopcDiscussionRecordingJob;
}

export interface XopcDiscussionRecordingManifest {
  lastSequence: number;
  chunkCount: number;
  mimeType: string;
  fileName: string;
  containerMode: 'independent_wav';
}
