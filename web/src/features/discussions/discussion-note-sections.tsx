import { AlertTriangle, CheckCircle2, Mic, Sparkles } from 'lucide-react';
import { useEffect } from 'react';
import useSWR from 'swr';

import { messages } from '@/i18n/messages';
import { useLocaleStore } from '@/stores/locale-store';

import { getDiscussionForNote } from './discussion-api';
import type { DiscussionDetail, DiscussionTranscriptSegment } from './discussion-types';

type SegmentEvent = {
  discussionId: string;
  transcriptRevision: number;
  segment: DiscussionTranscriptSegment;
  text: string;
  stats: DiscussionDetail['transcript']['stats'];
};

function BulletList({ values }: { values: string[] }) {
  if (values.length === 0) return null;
  return <ul className="list-disc space-y-1 pl-5">{values.map((value, index) => <li key={`${index}:${value}`}>{value}</li>)}</ul>;
}

export function DiscussionNoteSections({ noteId }: { noteId: string }) {
  const language = useLocaleStore((state) => state.language);
  const copy = messages(language).notes.discussionCapture;
  const { data: detail, mutate } = useSWR(
    ['note-discussion-document', noteId],
    () => getDiscussionForNote(noteId),
    { revalidateOnFocus: false },
  );

  useEffect(() => {
    const onSegment = (event: Event) => {
      const next = (event as CustomEvent<SegmentEvent>).detail;
      if (!next) return;
      void mutate((current) => {
        if (!current || current.discussion.id !== next.discussionId) return current;
        const segments = current.transcript.segments
          .filter((segment) => segment.sequence !== next.segment.sequence)
          .concat(next.segment)
          .sort((a, b) => a.sequence - b.sequence);
        return {
          ...current,
          discussion: { ...current.discussion, transcriptRevision: next.transcriptRevision },
          transcript: { ...current.transcript, revision: next.transcriptRevision, segments, text: next.text, stats: next.stats },
        };
      }, { revalidate: false });
    };
    const refresh = () => void mutate();
    window.addEventListener('discussion-segment-updated', onSegment);
    window.addEventListener('discussion-updated', refresh);
    return () => {
      window.removeEventListener('discussion-segment-updated', onSegment);
      window.removeEventListener('discussion-updated', refresh);
    };
  }, [mutate]);

  if (!detail) return null;
  const { discussion, transcript } = detail;
  const organization = detail.organization?.organization;
  const processing = ['stopping', 'sealing', 'organizing'].includes(discussion.status);

  return (
    <div className="max-h-[45%] shrink-0 overflow-y-auto border-b border-edge-subtle">
      {organization ? (
        <section className="border-b border-edge-subtle px-6 py-5">
          <div className="mb-3 flex items-center gap-2 text-sm font-semibold text-accent-fg">
            <Sparkles className="size-4" aria-hidden />
            {copy.organization}
          </div>
          <p className="text-sm leading-6 text-fg">{organization.summary}</p>
          <div className="mt-4 grid gap-4 text-sm leading-6 text-fg sm:grid-cols-2">
            {organization.decisions.length > 0 ? <div><h3 className="font-medium">{copy.decisions}</h3><BulletList values={organization.decisions} /></div> : null}
            {organization.actionItems.length > 0 ? <div><h3 className="font-medium">{copy.actionItems}</h3><BulletList values={organization.actionItems.map((item) => item.title)} /></div> : null}
            {organization.risks.length > 0 ? <div><h3 className="font-medium">{copy.risks}</h3><BulletList values={organization.risks} /></div> : null}
            {organization.openQuestions.length > 0 ? <div><h3 className="font-medium">{copy.openQuestions}</h3><BulletList values={organization.openQuestions} /></div> : null}
          </div>
        </section>
      ) : null}

      <section className="px-6 py-4">
        <div className="flex items-center justify-between gap-3">
          <div className="flex items-center gap-2 text-sm font-medium text-fg">
            <Mic className="size-4 text-accent" aria-hidden />
            {discussion.status === 'recording' ? copy.draftTranscript : copy.fullTranscript}
          </div>
          <div className="flex items-center gap-1.5 text-xs text-fg-muted">
            {discussion.status === 'needs_attention' ? <AlertTriangle className="size-3.5 text-danger" />
              : discussion.status === 'completed' ? <CheckCircle2 className="size-3.5 text-success" /> : null}
            {processing ? copy.finalizing : discussion.status === 'needs_attention' ? discussion.failureMessage : null}
          </div>
        </div>
        <div className="mt-3 max-h-48 overflow-y-auto whitespace-pre-wrap text-sm leading-6 text-fg-muted">
          {transcript.text || copy.waitingTranscript}
        </div>
      </section>
    </div>
  );
}
