import { ArrowRight, NotebookText, Repeat2 } from 'lucide-react';
import { Link } from 'react-router-dom';
import { useEffect, useState } from 'react';
import useSWR from 'swr';

import { Button } from '@/components/ui/button';
import { Skeleton } from '@/components/ui/skeleton';
import { getNote, listNotes } from '@/features/notes/notes-api';
import { NoteMarkdownView } from '@/features/notes/note-markdown-view';
import { messages } from '@/i18n/messages';
import { useGatewayStore } from '@/stores/gateway-store';
import { useLocaleStore } from '@/stores/locale-store';

import { RECURRING_WORK_SPEC_TAG, recurringWorkStage } from './recurring-work-model';
import { recurringWorkChatHref } from './recurring-work-chat-href';

const PAGE_SIZE = 10;

export function RecurringWorkDiscovery() {
  const language = useLocaleStore((state) => state.language);
  const copy = messages(language).recurringWork;
  const session = useGatewayStore((state) => state.conversationId);
  const [page, setPage] = useState(0);
  const { data, error, isLoading, mutate } = useSWR(
    session ? ['recurring-work-specs', session, page] : null,
    () => listNotes({ tag: RECURRING_WORK_SPEC_TAG, sortBy: 'updatedAt', sortOrder: 'desc', limit: PAGE_SIZE, offset: page * PAGE_SIZE }),
  );
  useEffect(() => {
    if (data && page > 0 && page * PAGE_SIZE >= data.total) setPage(Math.max(0, Math.ceil(data.total / PAGE_SIZE) - 1));
  }, [data, page]);
  const start = page * PAGE_SIZE + 1;
  const end = Math.min((page + 1) * PAGE_SIZE, data?.total ?? 0);

  return <section className="space-y-3" aria-labelledby="recurring-work-heading">
    <div className="rounded-xl border border-edge bg-surface-panel p-4 sm:p-6">
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div className="max-w-2xl space-y-2">
          <Repeat2 className="text-accent" size={20} aria-hidden="true" />
          <h2 id="recurring-work-heading" className="text-base font-semibold text-fg">
            {copy.title}
          </h2>
          <p className="text-sm text-fg-muted">
            {copy.description}
          </p>
          <p className="text-xs text-fg-subtle">{copy.designOnly}</p>
        </div>
        <Button asChild><Link to={recurringWorkChatHref(language)}>
          {copy.start}<ArrowRight size={16} aria-hidden="true" />
        </Link></Button>
      </div>
    </div>
    {session && isLoading && !data && <div className="space-y-2" aria-busy="true">
      <Skeleton className="h-5 w-28" /><Skeleton className="h-14 w-full" />
    </div>}
    {error && <div role="alert" className="flex flex-wrap items-center gap-3 rounded-xl border border-edge bg-surface-panel p-4">
      <p className="flex-1 text-sm text-danger">{copy.listError}</p>
      <Button variant="secondary" onClick={() => void mutate()}>{copy.retry}</Button>
    </div>}
    {data && !error && data.total === 0 && <p className="rounded-xl border border-edge bg-surface-panel p-4 text-sm text-fg-muted">{copy.empty}</p>}
    {data && !error && data.items.length > 0 && <div className="space-y-3">
      <h3 className="text-sm font-medium text-fg">{copy.savedPlans}</h3>
      <div className="grid gap-2 sm:grid-cols-2">
        {data.items.map((note) => {
          const stage = recurringWorkStage(note.tags);
          return <div key={note.id} data-plan-stage={stage} className="min-w-0 space-y-3 rounded-xl border border-edge bg-surface-panel px-4 py-3">
            <div className="flex min-w-0 items-center gap-3">
              <NotebookText size={18} className="shrink-0 text-fg-muted" aria-hidden="true" />
              <div className="min-w-0 flex-1">
                <p className="truncate text-sm font-medium text-fg">{note.title || copy.untitled}</p>
                {note.snippet && <p className="truncate text-xs text-fg-muted">{note.snippet}</p>}
              </div>
            </div>
            <p className="text-xs font-medium text-fg">{copy.stage[stage]}</p>
            <p className="text-xs text-fg-muted">{copy.nextStep[stage]}</p>
            <div className="flex flex-wrap items-center gap-2">
              <Button asChild variant="ghost"><Link data-plan-id={note.id} to={`/scenes?${new URLSearchParams({ plan: note.id, ...(note.projects?.[0]?.id ? { projectId: note.projects[0].id } : {}) })}`}>
                {copy.view}
              </Link></Button>
              <Button asChild variant="ghost"><Link to={recurringWorkChatHref(language, note.id, note.projects?.[0]?.id)}>
                {copy.continue}
              </Link></Button>
              {stage === 'ready' && <Button asChild variant="secondary"><Link to={recurringWorkChatHref(language, note.id, note.projects?.[0]?.id, 'implement')}>
                {copy.prepare}
              </Link></Button>}
            </div>
          </div>;
        })}
      </div>
      <div className="flex flex-wrap items-center justify-between gap-3">
        <p className="text-xs text-fg-muted">{copy.showing.replace('{start}', String(start)).replace('{end}', String(end)).replace('{total}', String(data.total))}</p>
        <div className="flex gap-2">
          <Button variant="secondary" disabled={page === 0} onClick={() => setPage((value) => Math.max(0, value - 1))}>{copy.previous}</Button>
          <Button variant="secondary" disabled={end >= data.total} onClick={() => setPage((value) => value + 1)}>{copy.next}</Button>
        </div>
      </div>
    </div>}
  </section>;
}

export function RecurringWorkPlanDetail({ noteId, projectId }: { noteId: string; projectId?: string }) {
  const language = useLocaleStore((state) => state.language);
  const copy = messages(language).recurringWork;
  const { data: note, error, isLoading, mutate } = useSWR(['recurring-work-spec', noteId], () => getNote(noteId));
  if (isLoading) return <div className="space-y-3" aria-busy="true"><Skeleton className="h-8 w-2/3" /><Skeleton className="h-40 w-full" /></div>;
  if (error) return <div role="alert" className="space-y-3"><p className="text-sm text-danger">{copy.loadError}</p>
    <Button onClick={() => void mutate()}>{copy.retry}</Button></div>;
  if (!note || !note.tags?.includes(RECURRING_WORK_SPEC_TAG)) return <p role="alert" className="text-sm text-fg-muted">{copy.missing}</p>;
  const stage = recurringWorkStage(note.tags);
  return <div className="space-y-5">
    <div className="space-y-1"><h2 className="text-lg font-semibold text-fg">{note.title || copy.untitled}</h2>
      <p className="text-xs font-medium text-fg">{copy.stage[stage]}</p>
      <p className="text-sm text-fg-muted">{copy.nextStep[stage]}</p>
      <p className="text-xs text-fg-subtle">{copy.planStatus}</p></div>
    {stage === 'ready' && <p className="rounded-lg border border-edge bg-surface-subtle p-3 text-sm text-fg-muted">{copy.beforeActivation}</p>}
    <NoteMarkdownView content={note.markdown} noteId={note.id} />
    <div className="flex flex-wrap gap-2 border-t border-edge pt-4">
      {stage === 'ready' && <Button asChild><Link to={recurringWorkChatHref(language, note.id, projectId, 'implement')}>{copy.prepareImplementation}</Link></Button>}
      <Button asChild variant="secondary"><Link to={recurringWorkChatHref(language, note.id, projectId)}>{copy.continueDiscussion}</Link></Button>
      <Button asChild variant="ghost"><Link to={`/notes/${encodeURIComponent(note.id)}`}>{copy.editInNotes}</Link></Button>
    </div>
  </div>;
}
