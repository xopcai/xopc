import { ArrowLeft, CheckCircle2, ExternalLink, Play, Radar } from 'lucide-react';
import { useCallback, useEffect, useLayoutEffect, useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';

import { Button } from '@/components/ui/button';
import { Skeleton } from '@/components/ui/skeleton';
import {
  configureFocusMonitor,
  deleteFocus,
  fetchFocus,
  fetchFocusActivities,
  fetchFocusInsights,
  handleFocusInsight,
  runFocusMonitor,
  updateFocus,
} from '@/features/focuses/api';
import { focusCopy } from '@/features/focuses/copy';
import type { Focus, FocusActivity, FocusInsight, FocusMonitorKind } from '@/features/focuses/types';
import { formatMediumDateTime } from '@/lib/date-formatters';
import { useLocaleStore } from '@/stores/locale-store';
import { usePageHeaderStore } from '@/stores/page-header-store';

export function FocusDetailPage() {
  const { focusId = '' } = useParams();
  const navigate = useNavigate();
  const language = useLocaleStore((state) => state.language);
  const copy = focusCopy(language);
  const setPageHeader = usePageHeaderStore((state) => state.setPageHeader);
  const clearPageHeader = usePageHeaderStore((state) => state.clearPageHeader);
  const [focus, setFocus] = useState<Focus | null>(null);
  const [activities, setActivities] = useState<FocusActivity[]>([]);
  const [insights, setInsights] = useState<FocusInsight[]>([]);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  const load = useCallback(async () => {
    if (!focusId) return;
    setError(null);
    try {
      const [nextFocus, nextActivities, nextInsights] = await Promise.all([
        fetchFocus(focusId), fetchFocusActivities(focusId), fetchFocusInsights(focusId),
      ]);
      setFocus(nextFocus);
      setActivities(nextActivities);
      setInsights(nextInsights);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setLoading(false);
    }
  }, [focusId]);

  useEffect(() => { void load(); }, [load]);
  useEffect(() => {
    const refresh = () => void load();
    const events = ['focus-updated', 'focus-monitor-updated', 'focus-run-updated', 'focus-insight-updated', 'focus-insight-created'];
    events.forEach((name) => window.addEventListener(name, refresh));
    return () => events.forEach((name) => window.removeEventListener(name, refresh));
  }, [load]);

  useLayoutEffect(() => {
    setPageHeader({ startExtra: null, main: <div className="min-w-0"><h1 className="truncate text-base font-semibold text-fg">{focus?.title ?? copy.current}</h1><p className="truncate text-xs text-fg-muted">{focus?.summary ?? ''}</p></div>, end: null });
    return () => clearPageHeader();
  }, [clearPageHeader, copy.current, focus?.summary, focus?.title, setPageHeader]);

  const execute = async (key: string, action: () => Promise<void>, message = copy.operationDone) => {
    setBusy(key); setError(null); setNotice(null);
    try { await action(); setNotice(message); await load(); }
    catch (err) { setError(err instanceof Error ? err.message : String(err)); }
    finally { setBusy(null); }
  };

  if (loading) return <main className="mx-auto w-full max-w-[1000px] space-y-4 px-4 py-7 sm:px-6"><Skeleton className="h-28 rounded-xl" /><Skeleton className="h-48 rounded-xl" /><Skeleton className="h-64 rounded-xl" /></main>;

  return (
    <main className="mx-auto flex w-full max-w-[1000px] flex-1 flex-col gap-6 px-4 py-7 sm:px-6 lg:py-9">
      <Link to="/work" className="flex w-fit items-center gap-1 text-xs font-medium text-fg-muted hover:text-fg"><ArrowLeft className="size-3.5" />{copy.back}</Link>
      {error ? <div role="alert" className="rounded-xl border border-danger/25 bg-danger-soft px-4 py-3 text-sm text-danger">{error}</div> : null}
      {notice ? <div role="status" className="rounded-xl border border-success/25 bg-success-soft px-4 py-3 text-sm text-success">{notice}</div> : null}
      {!focus ? <section className="rounded-xl border border-dashed border-edge p-8 text-center"><p className="text-sm text-fg-muted">Focus not found</p><Button className="mt-3" onClick={() => void load()}>{copy.retry}</Button></section> : <>
        <section className="rounded-2xl border border-edge-subtle bg-surface-panel p-5">
          <div className="flex flex-wrap items-start justify-between gap-4">
            <div className="min-w-0"><h2 className="text-xl font-semibold text-fg">{focus.title}</h2><p className="mt-2 max-w-3xl text-sm leading-6 text-fg-muted">{focus.summary}</p></div>
            <span className="rounded-full bg-surface-muted px-2.5 py-1 text-xs text-fg-muted">{focus.status}</span>
          </div>
          <div className="mt-4 flex flex-wrap gap-2 border-t border-edge-subtle pt-4">
            <Button variant="secondary" disabled={busy !== null} onClick={() => void execute('status', async () => { setFocus(await updateFocus(focus.id, { status: focus.status === 'paused' ? 'active' : 'paused' })); })}>{focus.status === 'paused' ? copy.resume : copy.pause}</Button>
            <Button variant="secondary" disabled={busy !== null || focus.status === 'completed'} onClick={() => void execute('complete', async () => { setFocus(await updateFocus(focus.id, { status: 'completed' })); })}><CheckCircle2 className="size-4" />{copy.complete}</Button>
            <Button variant="ghost" className="text-danger" disabled={busy !== null} onClick={() => { if (window.confirm(copy.deleteConfirm)) void execute('delete', async () => { await deleteFocus(focus.id); navigate('/work'); }); }}>{copy.remove}</Button>
          </div>
        </section>

        <section><h2 className="mb-3 text-base font-semibold text-fg">{copy.current}</h2><div className="grid gap-3 md:grid-cols-2">
          {(['progress', 'external_changes'] as FocusMonitorKind[]).map((kind) => {
            const monitor = focus.monitors.find((item) => item.kind === kind);
            const enabled = monitor?.enabled === true;
            return <article key={kind} className="rounded-xl border border-edge-subtle bg-surface-panel p-4">
              <div className="flex items-center justify-between gap-3"><h3 className="flex items-center gap-2 text-sm font-semibold text-fg"><Radar className="size-4 text-accent" />{kind === 'progress' ? copy.progress : copy.external}</h3><span className={`size-2 rounded-full ${enabled ? 'bg-success' : 'bg-fg-subtle/40'}`} /></div>
              <dl className="mt-3 space-y-2 text-xs text-fg-muted"><div className="flex justify-between gap-3"><dt>{copy.lastRun}</dt><dd>{monitor?.lastRunAt ? formatMediumDateTime(new Date(monitor.lastRunAt)) : copy.neverRun}</dd></div><div className="flex justify-between gap-3"><dt>{copy.nextRun}</dt><dd>{monitor?.nextRunAt ? formatMediumDateTime(new Date(monitor.nextRunAt)) : '—'}</dd></div></dl>
              {monitor?.lastError ? <p className="mt-3 rounded-lg bg-danger-soft px-3 py-2 text-xs text-danger">{monitor.lastError}</p> : null}
              <div className="mt-4 flex gap-2 border-t border-edge-subtle pt-3"><Button variant={enabled ? 'secondary' : 'primary'} className="h-8 text-xs" disabled={busy !== null || focus.status !== 'active'} onClick={() => void execute(`monitor-${kind}`, async () => { setFocus(await configureFocusMonitor(focus.id, kind, !enabled)); }, enabled ? copy.monitorStopped : copy.monitorStarted)}>{enabled ? copy.disableMonitor : kind === 'progress' ? copy.enableProgress : copy.enableExternal}</Button>{enabled ? <Button variant="ghost" className="h-8 text-xs" disabled={busy !== null} onClick={() => void execute(`run-${kind}`, () => runFocusMonitor(focus.id, kind), copy.queued)}><Play className="size-3.5" />{copy.runNow}</Button> : null}</div>
            </article>;
          })}
        </div></section>

        <section><h2 className="mb-3 text-base font-semibold text-fg">{copy.latest}</h2><div className="space-y-3">{insights.filter((item) => item.status === 'unread').map((insight) => <article key={insight.id} className="rounded-xl border border-accent/20 bg-accent-soft/15 p-4"><h3 className="text-sm font-semibold text-fg">{insight.title}</h3><p className="mt-2 text-sm leading-6 text-fg-muted">{insight.summary}</p><p className="mt-2 text-xs leading-5 text-fg-muted"><b className="text-fg">{copy.why}: </b>{insight.whyItMatters}</p><p className="mt-2 text-xs leading-5 text-fg-muted"><b className="text-fg">{copy.next}: </b>{insight.nextAction}</p><div className="mt-3 flex flex-wrap gap-2">{insight.evidence.map((item, index) => <span key={`${item.label}-${index}`} className="rounded-full border border-edge-subtle px-2 py-1 text-[11px] text-fg-subtle">{item.label}{item.source ? ` · ${item.source}` : ''}</span>)}</div><div className="mt-3 flex justify-end gap-2 border-t border-edge-subtle pt-3"><Button variant="ghost" className="h-8 text-xs" disabled={busy !== null} onClick={() => void execute(`dismiss-${insight.id}`, () => handleFocusInsight(focus.id, insight.id, 'dismiss'))}>{copy.dismiss}</Button><Button variant="primary" className="h-8 text-xs" disabled={busy !== null} onClick={() => void execute(`investigate-${insight.id}`, () => handleFocusInsight(focus.id, insight.id, 'investigate'))}><ExternalLink className="size-3.5" />{copy.investigate}</Button></div></article>)}{insights.every((item) => item.status !== 'unread') ? <p className="rounded-xl border border-dashed border-edge p-6 text-center text-sm text-fg-muted">{copy.noInsights}</p> : null}</div></section>
        <section><h2 className="mb-3 text-base font-semibold text-fg">{copy.activity}</h2><div className="rounded-xl border border-edge-subtle bg-surface-panel px-4">{activities.map((activity) => <div key={activity.id} className="flex gap-3 border-b border-edge-subtle py-3 last:border-0"><span className="mt-1.5 size-1.5 shrink-0 rounded-full bg-accent" /><div className="min-w-0"><p className="text-sm text-fg">{activity.summary}</p><time className="mt-1 block text-xs text-fg-subtle">{formatMediumDateTime(new Date(activity.createdAt))}</time></div></div>)}{activities.length === 0 ? <p className="py-6 text-center text-sm text-fg-muted">{copy.noActivity}</p> : null}</div></section>
      </>}
    </main>
  );
}
