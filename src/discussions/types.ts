export { DISCUSSION_STATUSES, DiscussionStatus, DiscussionSource, DiscussionProjectInferenceSource, DiscussionFailureStage, DiscussionFact, DiscussionChapter, DiscussionTemplate, DiscussionActionItem, DiscussionOrganization, DiscussionCapture, DiscussionTranscriptSegmentStatus, DiscussionTranscriptSegment, DiscussionTranscriptStats, DiscussionTranscript, DiscussionOrganizationRecord, DiscussionCaptureSettings, CreateDiscussionInput, ListDiscussionsQuery, DiscussionListResult, DiscussionMetrics } from '@xopcai/gateway-contract';
import type { DiscussionCapture, DiscussionTranscript, DiscussionOrganizationRecord } from '@xopcai/gateway-contract';

export interface DiscussionDetail {
  discussion: DiscussionCapture;
  note: import('../notes/types.js').Note;
  transcript: DiscussionTranscript;
  organization?: DiscussionOrganizationRecord;
  recordingJob?: import('@xopcai/gateway-contract').DiscussionRecordingJob;
}
