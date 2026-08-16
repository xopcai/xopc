import { Mic, Unlink } from 'lucide-react';
import { useEffect } from 'react';
import useSWR from 'swr';

import { messages } from '@/i18n/messages';
import { useLocaleStore } from '@/stores/locale-store';

import { getDiscussionForNote, getDiscussionTranscript, unlinkDiscussionProject } from './discussion-api';

export function LiveDiscussionTranscript({ noteId }: { noteId: string }) {
  const language = useLocaleStore((state) => state.language);
  const copy = messages(language).notes.discussionCapture;
  const { data: detail, mutate: mutateDetail } = useSWR(
    ['note-discussion', noteId],
    () => getDiscussionForNote(noteId),
    { refreshInterval: 5_000 },
  );
  const discussion = detail?.discussion;
  const active = discussion?.status === 'recording' || discussion?.status === 'finalizing';
  const discussionId = active ? discussion.id : null;
  const { data: transcript, mutate: mutateTranscript } = useSWR(
    discussionId ? ['note-discussion-transcript', discussionId] as const : null,
    ([, id]) => getDiscussionTranscript(id),
    { refreshInterval: active ? 5_000 : 0 },
  );

  useEffect(() => {
    if (!discussionId) return undefined;
    const refresh = () => {
      void mutateDetail();
      void mutateTranscript();
    };
    window.addEventListener('discussion-updated', refresh);
    window.addEventListener('discussion-transcript-updated', refresh);
    return () => {
      window.removeEventListener('discussion-updated', refresh);
      window.removeEventListener('discussion-transcript-updated', refresh);
    };
  }, [discussionId, mutateDetail, mutateTranscript]);

  if (!active || !discussion) return null;
  const inferredProject = discussion.projectId && discussion.projectInferenceSource !== 'context';

  return (
    <section className="mb-3 shrink-0 rounded-xl border border-accent/25 bg-accent-soft px-4 py-3">
      <div className="flex items-center justify-between gap-3">
        <div className="flex items-center gap-2 text-sm font-medium text-accent-fg">
          <Mic className="size-4" aria-hidden />
          {discussion.status === 'recording' ? copy.draftTranscript : copy.finalizing}
        </div>
        {inferredProject ? (
          <button
            type="button"
            className="inline-flex items-center gap-1 text-xs font-medium text-accent-fg"
            onClick={async () => mutateDetail(await unlinkDiscussionProject(discussion.id), { revalidate: false })}
          >
            <Unlink className="size-3" aria-hidden />
            {copy.undo}
          </button>
        ) : null}
      </div>
      <p className="mt-2 max-h-36 overflow-y-auto whitespace-pre-wrap text-sm leading-6 text-fg">
        {transcript?.text || copy.waitingTranscript}
      </p>
    </section>
  );
}
