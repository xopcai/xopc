import { XopcRecordingOutcomeInput } from './recordingOutcome';
import { XopcDiscussionDetail } from '../model/discussionCapture';

export function discussionOutcomeInput(detail?: XopcDiscussionDetail,localSave: string = 'unknown',sync: string = 'pending'): XopcRecordingOutcomeInput {
  return { localSave: localSave,sync: sync,serverStatus: detail?.discussion.status ?? '',failureStage: detail?.discussion.failureStage ?? '',
    jobState: detail?.recordingJob?.state ?? '',retryScheduled: !!detail?.processing?.nextAttemptAt,
    audioAvailable: !!detail?.discussion.audioAttachmentId,audioDeleted: !!detail?.discussion.audioDeletedAt,
    textAvailable: !!detail?.transcript.text?.trim() || !!detail?.discussion.canonicalTranscript?.trim(),noteAvailable: !!detail?.organization?.organization,
    analysisStale: !!detail?.organization && detail.organization.transcriptRevision !== detail.transcript.revision };
}
