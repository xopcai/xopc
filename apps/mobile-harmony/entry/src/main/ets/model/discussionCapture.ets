export type XopcDiscussionCapturePhase = 'idle' | 'starting' | 'recording' | 'paused' | 'stopping' | 'organizing' | 'completed' | 'error';

export interface XopcDiscussionCaptureSettings {
  consentPolicyVersion: number;
  consentAcknowledgedAt?: number;
}

export interface XopcDiscussionCaptureSummary {
  id: string;
  noteId: string;
  status: string;
}

export interface XopcDiscussionTranscriptSegment {
  sequence: number;
  status: string;
  displayText?: string;
  rawText?: string;
}

export interface XopcDiscussionTranscript {
  discussionId: string;
  revision: number;
  segments: XopcDiscussionTranscriptSegment[];
  text: string;
}

export interface XopcDiscussionDetail {
  discussion: XopcDiscussionCaptureSummary;
  transcript: XopcDiscussionTranscript;
}

export interface XopcDiscussionRecordingManifest {
  lastSequence: number;
  chunkCount: number;
  mimeType: string;
  fileName: string;
  containerMode: 'independent_wav';
}
