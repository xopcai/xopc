/** Local durability and server processing are independent; only confirmed audio permits leaving. */
export interface XopcRecordingOutcomeInput {
  localSave: string;
  sync: string;
  serverStatus: string;
  failureStage: string;
  jobState: string;
  retryScheduled: boolean;
  audioAvailable: boolean;
  audioDeleted: boolean;
  textAvailable: boolean;
  noteAvailable: boolean;
  analysisStale: boolean;
}
export interface XopcRecordingOutcome {
  stage: string;
  leave: string;
  retry: string;
  audio: boolean;
  text: boolean;
  note: boolean;
  stale: boolean;
}
export function projectRecordingOutcome(input: XopcRecordingOutcomeInput): XopcRecordingOutcome {
  const audio = input.audioAvailable && !input.audioDeleted;
  let stage: string = 'sync_pending';
  let retry: string = 'none';
  if (input.audioDeleted) stage = 'audio_deleted';
  else if (input.localSave === 'saving') stage = 'local_saving';
  else if (input.localSave === 'failed') stage = 'save_failed';
  else if (input.localSave === 'partial') { stage = 'local_partial'; retry = 'recover'; }
  else if (!audio) {
    if (input.jobState === 'failed') { stage = 'verify_failed'; retry = 'pipeline'; }
    else if (input.jobState === 'queued' || input.jobState === 'running' || input.sync === 'verifying') stage = 'verifying';
    else if (input.sync === 'offline' || input.sync === 'failed') { stage = 'sync_failed'; retry = input.localSave === 'complete' ? 'sync' : 'none'; }
    else if (input.localSave !== 'complete' && input.serverStatus === 'needs_attention') stage = 'source_missing';
  } else if (input.serverStatus === 'cancelled') stage = 'cancelled';
  else if (input.serverStatus === 'needs_attention') {
    stage = input.failureStage === 'organization' ? 'analysis_failed' : 'transcription_failed'; retry = 'pipeline';
  } else if (input.serverStatus === 'completed') {
    if (!input.noteAvailable) { stage = 'analysis_missing'; retry = 'regenerate'; }
    else if (input.analysisStale) { stage = 'analysis_stale'; retry = 'analyze'; }
    else stage = 'ready';
  } else if (input.serverStatus === 'organizing') stage = input.retryScheduled ? 'analysis_retrying' : 'organizing';
  else stage = input.retryScheduled ? 'transcription_retrying' : 'transcribing';
  return { stage,leave: input.localSave === 'saving' ? 'hold' : audio ? 'cloud' : input.localSave === 'complete' ? 'local' : 'hold',retry,
    audio,text: input.textAvailable,note: input.noteAvailable,stale: input.analysisStale };
}
