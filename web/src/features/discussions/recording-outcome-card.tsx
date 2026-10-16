import { projectRecordingOutcome, type XopcRecordingOutcomeInput } from '@xopcai/gateway-contract';
import { ChevronDown } from 'lucide-react';
import { Button } from '@/components/ui/button';
import type { DiscussionDetail } from './discussion-types';
import { recordingOutcomeStages, recordingOutcomePhrases } from './recording-outcome-copy';

export function recordingOutcomeInput(detail?: DiscussionDetail | null, localSave = 'unknown', sync = 'pending'): XopcRecordingOutcomeInput {
  return { localSave, sync, serverStatus: detail?.discussion.status ?? '', failureStage: detail?.discussion.failureStage ?? '',
    jobState: detail?.recordingJob?.state ?? '', retryScheduled: !!detail?.processing?.nextAttemptAt,
    audioAvailable: !!detail?.discussion.audioAttachmentId, audioDeleted: !!detail?.discussion.audioDeletedAt,
    textAvailable: !!detail?.transcript?.text?.trim() || !!detail?.discussion.canonicalTranscript?.trim(),
    noteAvailable: !!detail?.organization?.organization,
    analysisStale: !!detail?.organization && detail.organization.transcriptRevision !== detail.transcript?.revision };
}

export function RecordingOutcomeCard({ input, zh, compact = false, busy = false, onRetry, children, context = 'capture' }: {
  input: XopcRecordingOutcomeInput; zh: boolean; context?: 'capture' | 'note'; compact?: boolean; busy?: boolean;
  onRetry?: (mode: string) => void; children?: React.ReactNode;
}) {
  const state = projectRecordingOutcome(input);
  const stage = recordingOutcomeStages[state.stage as keyof typeof recordingOutcomeStages];
  const phrase = (key: keyof typeof recordingOutcomePhrases) => recordingOutcomePhrases[key][zh ? 0 : 1];
  const retryKey = (`retry_${['analysis_failed','transcription_failed','verify_failed'].includes(state.stage) ? state.stage : state.retry}`) as keyof typeof recordingOutcomePhrases;
  return <section aria-live="polite" data-recording-outcome={state.stage} className={context === 'note' ? 'text-fg' : 'rounded-xl bg-surface-inset p-3 text-fg'}>
    {context === 'capture' ? <p className="mb-1 text-sm font-medium">{phrase(`leave_${state.leave}` as keyof typeof recordingOutcomePhrases)}</p> : null}
    <details className="group" key={context}>
      <summary className="flex min-h-11 cursor-pointer list-none items-center gap-2 rounded-lg text-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent [&::-webkit-details-marker]:hidden">
        <span className={`size-1.5 shrink-0 rounded-full ${state.stage.endsWith('_failed') || state.stage === 'local_partial' ? 'bg-danger' : 'bg-accent'}`} aria-hidden />
        <span className="min-w-0 flex-1">{stage[zh ? 0 : 1]}</span>
        <ChevronDown className="size-3.5 shrink-0 text-fg-muted transition-transform group-open:rotate-180 motion-reduce:transition-none" aria-hidden />
      </summary>
      <div className="space-y-2 pb-3 text-xs leading-5 text-fg-muted">
        {context === 'note' ? <p>{phrase(`leave_${state.leave}` as keyof typeof recordingOutcomePhrases)}</p> : null}
        {!compact ? <>
          <p>{stage[zh ? 2 : 3]}</p>
          {state.leave === 'local' ? <p>{phrase('local_hint')}</p> : null}
          <ul className="flex flex-wrap gap-x-4 gap-y-1" aria-label={zh ? '已可用内容' : 'Available content'}>
            {(['audio','text','note'] as const).map(key => <li key={key}>{phrase(key)} · {key === 'note' && state.note && state.stale ? phrase('old_note') : phrase(state[key] ? 'available' : 'pending')}</li>)}
          </ul>
        </> : null}
      </div>
    </details>
    {state.retry !== 'none' && onRetry ? <Button className="min-h-11" disabled={busy} onClick={() => onRetry(state.retry)}>{phrase(retryKey)}</Button> : null}
    {children}
  </section>;
}
