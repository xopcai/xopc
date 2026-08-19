import { ArrowLeft, Download, MessageSquarePlus, RefreshCw } from 'lucide-react';
import { useCallback, useEffect, useLayoutEffect, useMemo, useState } from 'react';
import { Link, useNavigate, useParams, useSearchParams } from 'react-router-dom';

import { Button } from '@/components/ui/button';
import { Skeleton } from '@/components/ui/skeleton';
import {
  downloadWorkItemAttachment,
  executeWorkItemCommand,
  fetchWorkItem,
  fetchWorkItemEvents,
  setWorkItemArchived,
  startWorkItemChat,
  type WorkItem,
  type WorkItemCommand,
  type WorkItemEvent,
} from '@/features/work-items/api';
import { messages } from '@/i18n/messages';
import { formatMediumDateTime } from '@/lib/date-formatters';
import { safeInternalReturnPath } from '@/lib/navigation-return';
import { useLocaleStore } from '@/stores/locale-store';
import { usePageHeaderStore } from '@/stores/page-header-store';

function commandFor(item: WorkItem, type: WorkItemCommand['type']): WorkItemCommand | null {
  const expectedVersion = item.version;
  if (type === 'commit') return { type, expectedVersion };
  if (type === 'defer') return { type, expectedVersion };
  if (type === 'start') return { type, expectedVersion };
  if (type === 'stop') return { type, expectedVersion };
  if (type === 'request_review') return { type, expectedVersion, summary: 'Ready for verification.' };
  if (type === 'complete') return { type, expectedVersion };
  if (type === 'accept') return { type, expectedVersion };
  if (type === 'reopen') return { type, expectedVersion };
  return null;
}

export function WorkItemDetailPage() {
  const { workItemId = '' } = useParams();
  const navigate = useNavigate();
  const [searchParams] = useSearchParams();
  const language = useLocaleStore((state) => state.language);
  const t = messages(language).projectDetailPage.workItems;
  const [item, setItem] = useState<WorkItem | null>(null);
  const [availableCommands, setAvailableCommands] = useState<WorkItemCommand['type'][]>([]);
  const [events, setEvents] = useState<WorkItemEvent[]>([]);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const setPageHeader = usePageHeaderStore((state) => state.setPageHeader);
  const clearPageHeader = usePageHeaderStore((state) => state.clearPageHeader);

  const projectHref = item ? `/projects/${encodeURIComponent(item.projectId)}/work-items` : '/projects';
  const backPath = useMemo(() => safeInternalReturnPath(searchParams.get('returnTo'), projectHref, ['/projects', '/chat']), [projectHref, searchParams]);

  const load = useCallback(async () => {
    if (!workItemId) return;
    setLoading(true);
    setError(null);
    try {
      const [detail, activity] = await Promise.all([fetchWorkItem(workItemId), fetchWorkItemEvents(workItemId)]);
      setItem(detail.item);
      setAvailableCommands(detail.availableCommands);
      setEvents(activity.events);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : String(cause));
    } finally {
      setLoading(false);
    }
  }, [workItemId]);

  useEffect(() => { void load(); }, [load]);
  useLayoutEffect(() => {
    setPageHeader({
      startExtra: <Link to={backPath} aria-label={t.detail.backToProject}><ArrowLeft className="size-4" /></Link>,
      main: <div><h1 className="truncate text-base font-semibold text-fg">{item?.title ?? t.title}</h1><p className="text-xs text-fg-muted">{item?.phase}</p></div>,
      end: null,
    });
    return clearPageHeader;
  }, [backPath, clearPageHeader, item?.phase, item?.title, setPageHeader, t.detail.backToProject, t.title]);

  const runCommand = useCallback(async (type: WorkItemCommand['type']) => {
    if (!item) return;
    const command = commandFor(item, type);
    if (!command) return;
    setBusy(true);
    setError(null);
    try {
      const result = await executeWorkItemCommand(item.id, command);
      setItem(result.item);
      setAvailableCommands(result.availableCommands);
      setEvents((await fetchWorkItemEvents(item.id)).events);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : String(cause));
    } finally {
      setBusy(false);
    }
  }, [item]);

  if (loading) return <div className="mx-auto grid w-full max-w-5xl gap-4 p-6"><Skeleton className="h-10 w-64" /><Skeleton className="h-72 w-full" /></div>;
  if (!item) return <div className="mx-auto max-w-3xl p-8 text-sm text-danger">{error ?? 'Work item not found'}</div>;

  const openWaits = item.waits.filter((wait) => !wait.resolvedAt);
  const primaryCommands = availableCommands.filter((type) => ['commit', 'start', 'stop', 'request_review', 'complete', 'accept', 'reopen'].includes(type));

  return (
    <main className="mx-auto grid w-full max-w-5xl gap-5 p-4 sm:p-6">
      <header className="flex flex-wrap items-center justify-between gap-3">
        <Button variant="ghost" onClick={() => navigate(backPath)}><ArrowLeft className="size-4" />{t.detail.backToProject}</Button>
        <Button variant="secondary" onClick={() => void load()} disabled={busy}><RefreshCw className="size-4" />{t.refreshShort}</Button>
      </header>

      {error ? <div className="rounded-lg border border-danger/30 bg-danger-soft p-3 text-sm text-danger">{error}</div> : null}

      <section className="rounded-xl border border-edge bg-surface-panel p-5">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div><h1 className="text-xl font-semibold text-fg">{item.title}</h1><p className="mt-1 text-sm text-fg-muted">{item.phase} · {item.priority} · {item.completionPolicy}</p></div>
          <div className="flex flex-wrap gap-2">
            {primaryCommands.map((type) => <Button key={type} variant={type === 'complete' || type === 'accept' ? 'primary' : 'secondary'} disabled={busy} onClick={() => void runCommand(type)}>{type.replace(/_/g, ' ')}</Button>)}
            {item.phase !== 'closed' && item.phase !== 'verifying' ? <Button variant="secondary" disabled={busy} onClick={() => void startWorkItemChat(item.id).then((result) => navigate(`/chat/${encodeURIComponent(result.session.key)}`))}><MessageSquarePlus className="size-4" />{t.detail.startChat}</Button> : null}
            {item.phase === 'closed' ? <Button variant="ghost" disabled={busy} onClick={() => void setWorkItemArchived(item.id, !item.archivedAt, item.version).then((result) => setItem(result.item))}>{item.archivedAt ? 'Unarchive' : 'Archive'}</Button> : null}
          </div>
        </div>
        {item.description ? <p className="mt-5 whitespace-pre-wrap text-sm leading-6 text-fg-muted">{item.description}</p> : null}
        {item.nextAction ? <div className="mt-5 rounded-lg bg-surface-muted p-3 text-sm"><span className="font-medium">Next · {item.nextAction.actor}: </span>{item.nextAction.text}</div> : null}
        {openWaits.length ? <div className="mt-4 grid gap-2">{openWaits.map((wait) => <div key={wait.id} className="rounded-lg border border-warning/30 bg-warning-soft p-3 text-sm"><span className="font-medium">{wait.kind}: </span>{wait.reason}</div>)}</div> : null}
      </section>

      {item.attachments.length ? <section className="rounded-xl border border-edge bg-surface-panel p-5"><h2 className="font-semibold">Attachments</h2><div className="mt-3 grid gap-2">{item.attachments.map((attachment) => <button key={attachment.id} className="flex items-center justify-between rounded-lg border border-edge p-3 text-left text-sm hover:bg-surface-hover" onClick={() => void downloadWorkItemAttachment(item.id, attachment)}><span>{attachment.fileName}</span><Download className="size-4" /></button>)}</div></section> : null}

      <section className="rounded-xl border border-edge bg-surface-panel p-5">
        <h2 className="font-semibold">Activity</h2>
        <div className="mt-3 grid gap-3">{events.map((event) => <div key={event.id} className="flex justify-between gap-4 border-b border-edge-subtle pb-3 text-sm last:border-0"><span>{(t.eventTypes as Record<string, string>)[event.type] ?? event.type}</span><time className="text-fg-subtle">{formatMediumDateTime(new Date(event.createdAt))}</time></div>)}</div>
      </section>

      <Link to={projectHref} className="text-sm text-accent">Open project</Link>
    </main>
  );
}
