import * as Dialog from '@radix-ui/react-dialog';
import { PageContextCaptureButton } from '@/features/chat/context/page-context-capture-button';
import { ArrowLeft, CalendarDays, CirclePause, Inbox, RefreshCw, Settings2, Sparkles, X } from 'lucide-react';
import { useEffect, useLayoutEffect, useRef, useState, type FormEvent, type ReactNode } from 'react';
import { Link, useLocation, useMatch, useNavigate, useParams, useSearchParams } from 'react-router-dom';
import useSWR, { SWRConfig } from 'swr';

import { Button } from '@/components/ui/button';
import { Skeleton } from '@/components/ui/skeleton';
import { useLocaleStore } from '@/stores/locale-store';
import { useGatewayStore } from '@/stores/gateway-store';
import { usePageHeaderStore } from '@/stores/page-header-store';

import { sceneErrorText, sceneGet, sceneWrite, type SceneActivation, type SceneMetricsReport, type SceneNotes, type SceneOutcome, type SceneRun, type SceneTemplate } from './api';
import { SceneDiagnostics } from './scene-diagnostics';
import { SceneDirtyGuard } from './scene-dirty-guard';
import { SceneControlsDialog } from './scene-controls';
import { OutcomeCard } from './outcome-card';
import { ScheduleEditor } from './schedule-editor';
import { MailSourcePicker } from './mail-source-picker';
import { MailDeadlineEditor } from './mail-deadline-editor';
import { CreateTaskFollowUp, TaskFollowUpDetail } from './task-follow-up';
import { useSceneRealtime } from './use-scene-realtime';

const fieldClass = 'min-h-11 w-full rounded-md border border-edge bg-surface-panel px-3 py-2 text-base text-fg focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent sm:text-sm';
const panelClass = 'min-w-0 rounded-xl border border-edge bg-surface-panel p-4 sm:p-6';
const labelClass = 'grid gap-2 text-sm font-medium text-fg';

function statusText(status: string, zh: boolean) {
  const labels: Record<string, [string, string]> = {
    needs_setup: ['待完成设置', 'Finish setup'], active: ['已开启', 'Active'], paused: ['已暂停', 'Paused'],
    completed: ['已完成', 'Completed'], archived: ['已归档', 'Archived'], running: ['正在检查', 'Checking'],
    succeeded: ['已准备成果', 'Result ready'], skipped: ['无需新行动', 'No new action'], retry_wait: ['等待来源或预算', 'Waiting for source or budget'],
    failed: ['检查失败', 'Check failed'], cancelled: ['已取消', 'Cancelled'],
  };
  return labels[status]?.[zh ? 0 : 1] ?? status;
}

function Loading() {
  return <div className="space-y-4" aria-busy="true"><Skeleton className="h-8 w-48" /><Skeleton className="h-40 w-full" /><Skeleton className="h-32 w-full" /></div>;
}

function Failure({ error, retry }: { error: unknown; retry?: () => void }) {
  const zh = useLocaleStore((state) => state.language) === 'zh';
  if ((error as { status?: number } | undefined)?.status === 503) return <section className={`${panelClass} space-y-3`}>
    <h1 className="text-xl font-semibold text-fg">{zh ? '智能关注尚未开放' : 'Monitors are not available yet'}</h1>
    <p className="text-sm text-fg-muted">{sceneErrorText(error, zh)}</p>
    <Button asChild><Link to="/chat">{zh ? '返回对话' : 'Back to chat'}</Link></Button>
  </section>;
  return <div role="alert" className="space-y-3 rounded-xl border border-edge p-4"><p className="text-sm text-danger">{sceneErrorText(error, zh)}</p>
    {retry && <Button onClick={retry}><RefreshCw size={16} aria-hidden="true" />{zh ? '重新加载' : 'Reload'}</Button>}</div>;
}

export function ScenesPage() {
  const session = useGatewayStore((state) => state.conversationId);
  const expired = useGatewayStore((state) => state.tokenExpired);
  if (expired) return <Failure error={{ status: 401 }} />;
  return <SWRConfig key={session ?? 'anonymous'} value={{ provider: () => new Map() }}><SceneContent /></SWRConfig>;
}

function SceneContent() {
  useSceneRealtime();
  const { activationId, templateKey } = useParams();
  const inbox = useMatch('/scenes/inbox');
  const zh = useLocaleStore((state) => state.language) === 'zh';
  const [settingsOpen, setSettingsOpen] = useState(false);
  const settingsButton = useRef<HTMLButtonElement>(null);
  const location = useLocation();
  const [params] = useSearchParams();
  const inboxReturn = activationId && location.state?.fromSceneInbox === true
    ? `/scenes/inbox${typeof location.state.inboxSearch === 'string' ? location.state.inboxSearch : ''}` : undefined;
  const setPageHeader = usePageHeaderStore((state) => state.setPageHeader);
  const clearPageHeader = usePageHeaderStore((state) => state.clearPageHeader);
  useLayoutEffect(() => {
    const description = zh ? '把需要持续留意的事交给 AI，把时间留给自己。' : 'Let AI look after recurring needs, leaving more time for you.';
    const resultsLabel = zh ? '查看全部成果' : 'View all results';
    const settingsLabel = zh ? '检查与提醒设置' : 'Checks and reminders';
    setPageHeader({
      startExtra: null,
      main: <div className="min-w-0">
        <h1 className="truncate text-base font-semibold tracking-tight text-fg">{zh ? '智能关注' : 'Monitors'}</h1>
        <p className="truncate text-xs text-fg-muted" title={description}>{description}</p>
      </div>,
      end: <>
        <Button asChild variant="secondary" className="h-9">
          <Link data-scene-inbox to="/scenes/inbox" aria-label={resultsLabel} title={resultsLabel}>
            <Inbox className="size-4" aria-hidden="true" /><span className="hidden sm:inline">{resultsLabel}</span>
          </Link>
        </Button>
        <Button ref={settingsButton} type="button" variant="ghost" className="size-9 p-0"
          aria-label={settingsLabel} title={settingsLabel} aria-haspopup="dialog" onClick={() => setSettingsOpen(true)}>
          <Settings2 className="size-4" aria-hidden="true" />
        </Button>
      </>,
    });
    return () => clearPageHeader();
  }, [clearPageHeader, setPageHeader, zh]);
  return <>
    <main className="h-full overflow-y-auto bg-surface-panel"><div className="mx-auto w-full max-w-7xl space-y-6 px-4 py-7 sm:px-6 lg:px-8 lg:py-9">
      <SceneList />
    </div></main>
    {(activationId || templateKey || inbox) && <SceneDialog key={activationId ?? templateKey ?? 'inbox'}
      titleText={inbox ? (params.has('digest') ? (zh ? '摘要中的成果' : 'Results in this digest') : (zh ? '关注成果' : 'Monitor results')) : activationId ? (zh ? '关注详情' : 'Monitor details') : (zh ? '了解并开启' : 'Explore and start')}
      closeLabel={inbox ? (zh ? '关闭关注成果' : 'Close monitor results') : activationId ? (zh ? '关闭关注详情' : 'Close monitor details') : (zh ? '关闭关注设置' : 'Close monitor setup')}
      backTo={inboxReturn} backLabel={zh ? '返回成果' : 'Back to results'}
      restoreSelector={inbox ? '[data-scene-inbox]' : activationId ? `[data-scene-id="${CSS.escape(activationId)}"]` : `[data-scene-template="${CSS.escape(templateKey!)}"]`}>
      {inbox ? <SceneInbox /> : activationId ? <SceneDetail id={activationId} /> : <CreateScene templateKey={templateKey!} />}
    </SceneDialog>}
    <SceneControlsDialog zh={zh} open={settingsOpen} onOpenChange={setSettingsOpen} onCloseAutoFocus={() => settingsButton.current?.focus()} />
  </>;
}

function SceneDialog({ titleText, closeLabel, restoreSelector, backTo, backLabel, children }: {
  titleText: string; closeLabel: string; restoreSelector: string; backTo?: string; backLabel?: string; children: ReactNode;
}) {
  const navigate = useNavigate();
  const title = useRef<HTMLHeadingElement>(null);
  const close = () => navigate('/scenes', { replace: true });
  return <Dialog.Root open onOpenChange={open => { if (!open) close(); }}>
    <Dialog.Portal>
      <Dialog.Overlay className="xopc-dialog-overlay fixed inset-0 z-[80] bg-scrim backdrop-blur-[2px]" />
      <Dialog.Content className="xopc-dialog-content fixed left-1/2 top-1/2 z-[90] flex h-[min(52rem,calc(100dvh-2rem))] w-[min(52rem,calc(100vw-2rem))] -translate-x-1/2 -translate-y-1/2 flex-col overflow-hidden rounded-xl border border-edge bg-surface-overlay shadow-float focus:outline-none"
        aria-describedby={undefined}
        onOpenAutoFocus={event => { event.preventDefault(); title.current?.focus(); }}
        onCloseAutoFocus={event => {
          event.preventDefault();
          document.querySelector<HTMLElement>(restoreSelector)?.focus();
        }}>
        <header className="flex shrink-0 items-center justify-between gap-3 border-b border-edge px-4 py-3 sm:px-6">
          {backTo && <Button asChild variant="ghost" className="size-9 shrink-0 p-0"><Link to={backTo} replace aria-label={backLabel} title={backLabel}><ArrowLeft size={18} aria-hidden="true" /></Link></Button>}
          <Dialog.Title ref={title} tabIndex={-1} className="min-w-0 flex-1 text-base font-semibold text-fg outline-none">{titleText}</Dialog.Title>
          <Dialog.Close asChild><Button type="button" variant="ghost" className="size-9 shrink-0 p-0" aria-label={closeLabel} title={closeLabel}><X size={18} aria-hidden="true" /></Button></Dialog.Close>
        </header>
        <div className="min-h-0 flex-1 overflow-y-auto overscroll-contain p-4 sm:p-6"><div className="space-y-6">{children}</div></div>
      </Dialog.Content>
    </Dialog.Portal>
  </Dialog.Root>;
}

function SceneList() {
  const { activationId } = useParams();
  const zh = useLocaleStore((state) => state.language) === 'zh';
  const [params, setParams] = useSearchParams();
  const cursor = params.get('after') ?? '';
  const templates = useSWR<{ templates: SceneTemplate[] }>('/templates', sceneGet);
  const mine = useSWR<{ activations: SceneActivation[]; nextCursor: string | null }>(`/activations?limit=20&afterId=${encodeURIComponent(cursor)}`, sceneGet);
  const refreshScenes = mine.mutate;
  useEffect(() => { if (!activationId) void refreshScenes(); }, [activationId, refreshScenes]);
  if (templates.error || mine.error) return <Failure error={templates.error ?? mine.error} retry={() => { void templates.mutate(); void mine.mutate(); }} />;
  if (!templates.data || !mine.data) return <Loading />;
  return <>
    <section className="space-y-3"><h2 className="text-base font-semibold text-fg">{zh ? '你想先轻松一点的事' : 'Where could you use a little help?'}</h2>
      <div className="grid gap-4 sm:grid-cols-2">{templates.data.templates.map((template) => <article key={`${template.key}:${template.version}`} className={`${panelClass} space-y-3`}>
        <Sparkles className="text-fg-muted" size={20} aria-hidden="true" /><h3 className="text-balance font-medium text-fg">{template.title}</h3>
        <p className="text-sm text-fg-muted">{template.description}</p><Button asChild><Link data-scene-template={template.key} to={`/scenes/new/${encodeURIComponent(template.key)}?version=${encodeURIComponent(template.version)}`}>{zh ? '了解并开启' : 'Explore and start'}</Link></Button>
      </article>)}</div></section>
    <section className="space-y-3"><h2 className="text-base font-semibold text-fg">{zh ? '我的关注' : 'My monitors'}</h2>
      {mine.data.activations.length ? mine.data.activations.map((activation) => <Link key={activation.id} to={`/scenes/${activation.id}`} data-scene-id={activation.id} className={`${panelClass} block space-y-2 transition-colors hover:bg-surface-hover focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent`}>
        <p className="break-words font-medium text-fg">{activation.goal}</p><p className="text-sm text-fg-muted">{statusText(activation.status === 'active' && activation.setupMissing?.length ? 'needs_setup' : activation.status, zh)}</p>
      </Link>) : <div className={`${panelClass} space-y-2`}><CalendarDays aria-hidden="true" className="text-fg-muted" /><p className="text-fg">{zh ? '还没有开启智能关注' : 'No monitors yet'}</p><p className="text-sm text-fg-muted">{zh ? '从上面选择一件你希望 AI 帮忙照看的事。' : 'Choose something above that you would like AI to monitor.'}</p></div>}
      <div className="flex gap-3">{cursor && <Button onClick={() => setParams({})}>{zh ? '返回第一页' : 'First page'}</Button>}{mine.data.nextCursor && <Button onClick={() => setParams({ after: mine.data!.nextCursor! })}>{zh ? '下一页' : 'Next page'}</Button>}</div>
    </section>
  </>;
}

function FeedbackOverview({ zh }: { zh: boolean }) {
  const metrics = useSWR<SceneMetricsReport>('/metrics', sceneGet, { refreshInterval: 15000, shouldRetryOnError: false });
  const labels = zh ? ['有帮助的成果', '没有帮助的成果', '带来帮助的关注'] : ['Helpful results', 'Unhelpful results', 'Monitors that helped'];
  const values = metrics.data ? [metrics.data.usefulOutcomes, metrics.data.unhelpfulOutcomes, metrics.data.scenesWithUsefulOutcomes] : [];
  const number = new Intl.NumberFormat(zh ? 'zh-CN' : 'en');
  return <section className={`${panelClass} space-y-3`} aria-label={zh ? '反馈概览' : 'Feedback overview'}>
    <h2 className="text-balance text-base font-semibold text-fg">{zh ? '最近 7 天的反馈' : 'Feedback in the last 7 days'}</h2>
    {metrics.error ? <div role="alert" className="space-y-2"><p className="text-sm text-fg-muted">{zh ? '暂时无法加载统计，仍可查看和评价成果。' : 'Stats are unavailable. You can still view and rate results.'}</p>
      <Button disabled={metrics.isValidating} onClick={() => void metrics.mutate()}>{zh ? '重新加载统计' : 'Reload stats'}</Button></div>
      : <dl className="grid gap-4 sm:grid-cols-3" aria-busy={!metrics.data}>{labels.map((label, index) => <div key={label} className="min-w-0 space-y-1">
        <dt className="text-sm text-fg-muted">{label}</dt><dd className="text-xl font-semibold tabular-nums text-fg">{metrics.data ? number.format(values[index]) : <Skeleton className="h-7 w-12" />}</dd>
      </div>)}</dl>}
    <p className="text-sm text-fg-muted">{zh ? '按你这段时间的明确反馈统计，每份成果取最新评价。已读和检查成功不计入，也不代表已采纳或节省时间。' : 'Counts your explicit feedback during this period, using the latest rating per result. Reads and successful checks do not count. This does not measure adoption or time saved.'}</p>
  </section>;
}

function SceneInbox() {
  const zh = useLocaleStore((state) => state.language) === 'zh';
  const [params, setParams] = useSearchParams();
  const cursor = params.get('after') ?? '';
  const digestId = params.get('digest');
  const results = useSWR<{ outcomes: SceneOutcome[]; nextCursor: string | null }>(`${digestId ? `/digests/${encodeURIComponent(digestId)}` : '/outcomes'}?limit=20&afterId=${encodeURIComponent(cursor)}`, sceneGet, { refreshInterval: 15000 });
  if (results.error) return <Failure error={results.error} retry={() => void results.mutate()} />;
  if (!results.data) return <Loading />;
  return <><p className="text-sm text-fg-muted">{zh ? '集中查看各项智能关注准备的成果，告诉 AI 哪些对你有帮助。' : 'Review results across your monitors and tell AI what helps.'}</p>
    <FeedbackOverview zh={zh} />
    <section className="space-y-4" aria-label={zh ? '成果列表' : 'Results list'}>
      {results.data.outcomes.length ? results.data.outcomes.map((item) => <div key={item.id} className="space-y-2">
        <OutcomeCard item={item} zh={zh} onChange={() => void results.mutate()} />
        <Button asChild variant="ghost"><Link state={{ fromSceneInbox: true, inboxSearch: `?${params.toString()}` }} to={`/scenes/${encodeURIComponent(item.activationId)}`}>{zh ? '查看所属关注' : 'View monitor'}</Link></Button>
      </div>) : <div className={`${panelClass} space-y-3`}><Inbox size={32} aria-hidden="true" className="text-fg-muted" /><h2 className="text-base font-semibold text-fg">{zh ? '这里还没有成果' : 'No results here yet'}</h2>
        <p className="text-sm text-fg-muted">{digestId ? (zh ? '这份摘要中的成果目前不可查看，可能已被撤回。' : 'Results in this digest are currently unavailable and may have been withdrawn.') : (zh ? '回到智能关注，提供资料并检查一次；有新成果时会出现在这里。' : 'Open a monitor, provide context and run a check. New results will appear here.')}</p></div>}
    </section>
    <nav className="flex flex-wrap gap-3" aria-label={zh ? '成果分页' : 'Results pages'}>{cursor && <Button onClick={() => setParams(digestId ? { digest: digestId } : {})}>{zh ? '返回第一页' : 'First page'}</Button>}
      {results.data.nextCursor && <Button onClick={() => setParams({ ...(digestId ? { digest: digestId } : {}), after: results.data!.nextCursor! })}>{zh ? '下一页' : 'Next page'}</Button>}</nav>
  </>;
}

function CreateScene({ templateKey }: { templateKey: string }) {
  return templateKey === 'task-follow-up' ? <CreateTaskFollowUp /> : <CreateReadOnlyScene templateKey={templateKey} />;
}

function CreateReadOnlyScene({ templateKey }: { templateKey: string }) {
  const zh = useLocaleStore((state) => state.language) === 'zh';
  const [params] = useSearchParams();
  const navigate = useNavigate();
  const version = params.get('version') ?? '1.0.0';
  const template = useSWR<{ template: SceneTemplate }>(`/templates/${encodeURIComponent(templateKey)}/versions/${encodeURIComponent(version)}`, sceneGet);
  const [goal, setGoal] = useState('');
  const [accountId, setAccountId] = useState('');
  const [subjectId, setSubjectId] = useState('');
  const [confirmed, setConfirmed] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<unknown>();
  const [saved, setSaved] = useState(false);
  const key = useRef({ content: '', id: '' });
  const savedId = useRef('');
  const dirty = Boolean(goal || subjectId || confirmed) && !saved;
  useEffect(() => { if (saved) navigate(savedId.current, { replace: true }); }, [saved, navigate]);
  if (template.error) return <Failure error={template.error} retry={() => void template.mutate()} />;
  if (!template.data) return <Loading />;
  const manifest = template.data.template;
  const mail = manifest.contextProviders.includes('mail');
  const start = async (event: FormEvent) => {
    event.preventDefault(); setBusy(true); setError(undefined);
    const input = { templateKey, templateVersion: version, goal, scope: mail ? { kind: 'objects', ids: [subjectId.trim()] } : { kind: 'personal' },
      permissions: { accountIds: mail ? [accountId.trim()] : [], contextProviders: manifest.contextProviders, effectHandlers: [] } };
    const content = JSON.stringify(input);
    if (key.current.content !== content) key.current = { content, id: crypto.randomUUID() };
    try {
      const result = await sceneWrite<{ activation: SceneActivation }>('/activations', 'POST', input, key.current.id);
      savedId.current = `/scenes/${result.activation.id}`; setSaved(true);
    } catch (reason) { setError(reason); } finally { setBusy(false); }
  };
  return <><SceneDirtyGuard dirty={dirty} zh={zh} /><header><h1 className="text-wrap text-xl font-semibold text-fg">{manifest.title}</h1><p className="mt-2 text-sm text-fg-muted">{manifest.description}</p></header>
    <form onSubmit={(event) => void start(event)} className={`${panelClass} space-y-5`}>
      <fieldset disabled={busy || saved} className="space-y-5">
      <label className={labelClass}>{zh ? '希望它持续帮你做好什么？' : 'What should it keep helping you with?'}<textarea required maxLength={4000} rows={3} value={goal} onChange={(event) => setGoal(event.target.value)} className={fieldClass} autoComplete="off" /></label>
      {mail && <MailSourcePicker value={subjectId} disabled={busy || saved} zh={zh} onChange={(source) => { setAccountId(source.accountId); setSubjectId(source.id); setConfirmed(false); }} />}
      <p className="text-sm text-fg-muted">{zh ? '只准备草稿和建议，不发送消息、不执行外部写操作。下一步需补齐资料和检查时间；完成后才会自动检查。' : 'Prepares drafts and suggestions only. No messages or external writes. Next, complete the context and timing settings for automatic checks.'}</p>
      <label className="flex min-h-11 items-center gap-3 text-sm text-fg"><input required type="checkbox" className="ui-checkbox" checked={confirmed} onChange={(event) => setConfirmed(event.target.checked)} />{zh ? '确认以上范围，允许读取我提供的资料。' : 'I confirm this scope and allow reading the information I provide.'}</label>
      {Boolean(error) && <Failure error={error} />}<Button type="submit" variant="primary" disabled={busy || saved || (mail && !subjectId)}>{busy ? (zh ? '正在开启…' : 'Starting…') : (zh ? '继续设置' : 'Continue setup')}</Button>
      </fieldset>
    </form></>;
}

function SceneDetail({ id }: { id: string }) {
  const detail = useSWR<{ activation: SceneActivation }>(`/activations/${encodeURIComponent(id)}`, sceneGet);
  if (detail.error) return <Failure error={detail.error} />;
  if (!detail.data) return <Loading />;
  return detail.data.activation.templateKey === 'task-follow-up' ? <TaskFollowUpDetail id={id} /> : <ReadOnlySceneDetail id={id} />;
}

function ReadOnlySceneDetail({ id }: { id: string }) {
  const zh = useLocaleStore((state) => state.language) === 'zh';
  const [params] = useSearchParams();
  const selectedResult = params.get('result');
  const path = `/activations/${encodeURIComponent(id)}`;
  const [runCursor, setRunCursor] = useState('');
  const [resultCursor, setResultCursor] = useState('');
  const detail = useSWR<{ activation: SceneActivation }>(path, sceneGet, { refreshInterval: 15000 });
  const runs = useSWR<{ runs: SceneRun[]; nextCursor: string | null }>(`${path}/runs?limit=20&afterId=${encodeURIComponent(runCursor)}`, sceneGet, { refreshInterval: 5000 });
  const results = useSWR<{ outcomes: SceneOutcome[]; nextCursor: string | null }>(`/outcomes?limit=20&activationId=${encodeURIComponent(id)}&afterId=${encodeURIComponent(resultCursor)}`, sceneGet, { refreshInterval: 5000 });
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<unknown>();
  const [queued, setQueued] = useState(false);
  const checkKey = useRef<string | null>(null);
  const [notesDirty, setNotesDirty] = useState(false);
  const [scheduleDirty, setScheduleDirty] = useState(false);
  const [goalDirty, setGoalDirty] = useState(false);
  const dirty = notesDirty || scheduleDirty || goalDirty;
  const act = async (check: boolean) => {
    if (!detail.data) return;
    setBusy(true); setError(undefined); setQueued(false);
    try {
      if (check) {
        checkKey.current ??= crypto.randomUUID();
        await sceneWrite(`${path}/checks`, 'POST', undefined, checkKey.current);
        checkKey.current = null; setQueued(true); setRunCursor(''); setResultCursor('');
      } else await sceneWrite(path, 'PATCH', { expectedRevision: detail.data.activation.revision, status: detail.data.activation.status === 'active' ? 'paused' : 'active' });
      await Promise.all([detail.mutate(), runs.mutate(), results.mutate()]);
    } catch (reason) { setError(reason); } finally { setBusy(false); }
  };
  if (detail.error) return <Failure error={detail.error} retry={() => void detail.mutate()} />;
  if (!detail.data) return <Loading />;
  const activation = detail.data.activation;
  return <><SceneDirtyGuard dirty={dirty} zh={zh} /><header className="space-y-3"><h1 className="break-words text-wrap text-xl font-semibold text-fg">{activation.goal}</h1>
    <PageContextCaptureButton resource={{ kind: 'scene', id: activation.id, revision: String(activation.revision) }} disabled={dirty || busy} />
    <p className="text-sm text-fg-muted">{statusText(activation.status === 'active' && activation.setupMissing?.length ? 'needs_setup' : activation.status, zh)}</p>
    <p className="text-sm text-fg-muted">{(zh ? '只准备建议和成果，不自动发送或写入外部系统。' : 'Prepares suggestions and results. Does not send or write to external systems.')}</p>
    <div className="flex flex-wrap gap-3"><Button variant="primary" disabled={busy || activation.status !== 'active'} onClick={() => void act(true)}>{busy ? (zh ? '处理中…' : 'Working…') : (zh ? '现在检查' : 'Check now')}</Button>
      {['active', 'paused', 'needs_setup'].includes(activation.status) && <Button disabled={busy} onClick={() => void act(false)}><CirclePause size={16} aria-hidden="true" />{activation.status === 'active' ? (zh ? '暂停关注' : 'Pause monitor') : (zh ? '检查设置并恢复' : 'Review setup and resume')}</Button>}</div>
    {['active', 'paused'].includes(activation.status) && <Button disabled={busy} variant="ghost" onClick={() => {
      setBusy(true); void sceneWrite(path, 'PATCH', { expectedRevision: activation.revision, status: 'completed' })
        .then(() => Promise.all([detail.mutate(), results.mutate(), runs.mutate()])).catch(setError).finally(() => setBusy(false));
    }}>{zh ? '结束关注（保留成果）' : 'End monitor (keep results)'}</Button>}
    {queued && <p role="status" className="text-sm text-fg-muted">{zh ? '检查已排队；没有新变化时不会生成新卡片。' : 'Check queued. No new card is created when nothing has changed.'}</p>}
  </header>{error && <Failure error={error} retry={() => { void detail.mutate(); setError(undefined); }} />}
    {activation.status === 'active' && !!activation.setupMissing?.length && <section role="status" className={panelClass}>
      <h2 className="font-medium text-fg">{zh ? '完成以下设置后，这项关注才会自动检查' : 'Complete setup for automatic checks'}</h2>
      <ul className="mt-2 list-inside list-disc text-sm text-fg-muted">{activation.setupMissing.map(item => <li key={item}>{({ notes: zh ? '填写安排和约束' : 'Provide arrangements and constraints', schedule: zh ? '设置周期检查时间' : 'Set a recurring review time', deadline: zh ? '设置邮件跟进截止时间' : 'Set a mail follow-up deadline' } as Record<string, string>)[item]}</li>)}</ul>
    </section>}
    <SceneDiagnostics activationId={id} zh={zh} />
    {['active', 'paused', 'needs_setup'].includes(activation.status) && <GoalEditor key={activation.id} activation={activation} zh={zh} onDirty={setGoalDirty} onSaved={() => { void detail.mutate(); void results.mutate(); void runs.mutate(); }} />}
    {activation.permissions.contextProviders.includes('user_notes') && <NotesEditor path={path} zh={zh} onDirty={setNotesDirty} onSaved={() => { void detail.mutate(); void results.mutate(); void runs.mutate(); }} />}
    {(activation.templateKey === 'mail-follow-up' ? <MailDeadlineEditor activation={activation} zh={zh} onDirty={setScheduleDirty} onChanged={() => { void detail.mutate(); void results.mutate(); void runs.mutate(); }} /> : <ScheduleEditor activation={activation} zh={zh} onDirty={setScheduleDirty} onChanged={() => void detail.mutate()} />)}
    {selectedResult && <LinkedSceneResult activationId={id} presentationId={selectedResult} zh={zh} />}
    <section className="space-y-3"><h2 className="text-base font-semibold text-fg">{zh ? '最近成果' : 'Recent results'}</h2>
      {results.error ? <Failure error={results.error} retry={() => void results.mutate()} /> : !results.data ? <Loading /> : results.data.outcomes.filter((item) => item.activationId === id).length === 0
        ? <p className="text-sm text-fg-muted">{(zh ? '还没有新成果。提供资料后，可以先检查一次。' : 'No new results yet. Provide context and try a check.')}</p>
        : results.data.outcomes.map((item) => <OutcomeCard key={item.id} item={item} zh={zh} onChange={() => void results.mutate()} />)}
      <div className="flex flex-wrap gap-3">{resultCursor && <Button onClick={() => setResultCursor('')}>{zh ? '最近成果' : 'Latest results'}</Button>}{results.data?.nextCursor && <Button onClick={() => setResultCursor(results.data!.nextCursor!)}>{zh ? '更早成果' : 'Earlier results'}</Button>}</div>
    </section>
    <section className="space-y-3"><h2 className="text-base font-semibold text-fg">{zh ? '检查记录' : 'Check history'}</h2>
      {runs.error ? <Failure error={runs.error} retry={() => void runs.mutate()} /> : !runs.data ? <Loading /> : runs.data.runs.length === 0 ? <p className="text-sm text-fg-muted">{zh ? '尚未执行检查。' : 'No checks yet.'}</p>
        : <ul className="divide-y divide-edge">{runs.data.runs.map((run) => <li key={run.id} className="flex flex-wrap justify-between gap-2 py-3 text-sm"><span className="text-fg">{statusText(run.status, zh)}{run.reason === 'empty_input' ? (zh ? '：请先提供资料' : ': provide context first') : ''}</span><time className="text-fg-muted" dateTime={new Date(run.createdAt).toISOString()}>{new Intl.DateTimeFormat(zh ? 'zh-CN' : 'en', { dateStyle: 'medium', timeStyle: 'short' }).format(run.createdAt)}</time></li>)}</ul>}
      <div className="flex flex-wrap gap-3">{runCursor && <Button onClick={() => setRunCursor('')}>{zh ? '最近检查' : 'Latest checks'}</Button>}{runs.data?.nextCursor && <Button onClick={() => setRunCursor(runs.data!.nextCursor!)}>{zh ? '更早检查' : 'Earlier checks'}</Button>}</div>
    </section></>;
}

function GoalEditor({ activation, zh, onDirty, onSaved }: { activation: SceneActivation; zh: boolean; onDirty: (dirty: boolean) => void; onSaved: () => void }) {
  const [draft, setDraft] = useState<{ base: SceneActivation; goal: string } | null>(null);
  const goal = draft?.goal ?? activation.goal;
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<unknown>();
  useEffect(() => { onDirty(goal !== activation.goal); return () => onDirty(false); }, [goal, activation.goal, onDirty]);
  return <details className={`${panelClass} space-y-3`}><summary className="cursor-pointer">{zh ? '修改目标' : 'Edit goal'}</summary>
    <p className="text-sm text-fg-muted">{zh ? '保存后暂停检查并撤回旧建议。确认设置后恢复；邮件跟进时间需另行恢复。' : 'Saving pauses checks and withdraws previous suggestions. Review settings before resuming, including mail deadlines.'}</p>
    <label className={labelClass}>{zh ? '新目标' : 'New goal'}<textarea disabled={busy} value={goal} maxLength={4000} onChange={e => setDraft(previous => ({ base: previous?.base ?? activation, goal: e.target.value }))} className={fieldClass} /></label>
    <Button disabled={busy || !goal.trim() || goal === activation.goal} onClick={() => {
      setBusy(true); setError(undefined);
      const base = draft?.base ?? activation;
      void sceneWrite(`/activations/${activation.id}`, 'PATCH', { expectedRevision: base.revision, goal, scope: base.scope, permissions: base.permissions })
        .then(() => { setDraft(null); onSaved(); }).catch(setError).finally(() => setBusy(false));
    }}>{zh ? '保存目标' : 'Save goal'}</Button>
    {draft && <Button type="button" variant="ghost" disabled={busy} onClick={() => { setDraft(null); setError(undefined); }}>{zh ? '放弃修改' : 'Discard edits'}</Button>}
    {error != null && <p role="alert" className="text-danger">{sceneErrorText(error, zh)}</p>}
  </details>;
}

function LinkedSceneResult({ activationId, presentationId, zh }: { activationId: string; presentationId: string; zh: boolean }) {
  const result = useSWR<{ outcome: SceneOutcome }>(`/presentations/${encodeURIComponent(presentationId)}`, sceneGet);
  if (result.error) return <Failure error={result.error} />;
  if (!result.data) return <Loading />;
  if (result.data.outcome.activationId !== activationId) return <Failure error={{ status: 404 }} />;
  return <section className="space-y-3"><h2 className="text-base font-semibold text-fg">{zh ? '通知中的成果' : 'Result from notification'}</h2>
    <OutcomeCard key={result.data.outcome.id} item={result.data.outcome} zh={zh} onChange={() => void result.mutate()} /></section>;
}

function NotesEditor({ path, zh, onSaved, onDirty }: { path: string; zh: boolean; onSaved: () => void; onDirty: (dirty: boolean) => void }) {
  const notes = useSWR<{ notes: SceneNotes }>(`${path}/notes`, sceneGet, { revalidateOnFocus: false });
  const [draft, setDraft] = useState<SceneNotes | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<unknown>();
  const dirty = draft !== null && draft.content !== notes.data?.notes.content;
  useEffect(() => { onDirty(dirty); return () => onDirty(false); }, [dirty, onDirty]);
  if (notes.error) return <Failure error={notes.error} retry={() => void notes.mutate()} />;
  if (!notes.data) return <Loading />;
  const save = async (event: FormEvent) => {
    event.preventDefault(); setBusy(true); setError(undefined);
    try {
      const { content, revision, validUntil } = draft ?? notes.data!.notes;
      const result = await sceneWrite<{ revision: number }>(`${path}/notes`, 'PATCH', { expectedRevision: revision, content, validUntil });
      await notes.mutate({ notes: { content: content.trim(), revision: result.revision, validUntil } }, { revalidate: false });
      setDraft(null); onSaved();
    } catch (reason) { setError(reason); } finally { setBusy(false); }
  };
  return <form onSubmit={(event) => void save(event)} className={`${panelClass} space-y-3`}><label className={labelClass}>{zh ? '你愿意提供的安排和约束' : 'Arrangements and constraints you choose to share'}<textarea disabled={busy} rows={5} maxLength={32000} className={fieldClass} value={draft?.content ?? notes.data.notes.content} onChange={(event) => setDraft((previous) => ({ ...(previous ?? notes.data!.notes), content: event.target.value }))} autoComplete="off" /></label>
    <p className="text-sm text-fg-muted">{zh ? '只用于这项关注，不会因此访问其他家庭成员的数据。修改资料会撤回旧计划。' : 'Used only by this monitor. Does not grant access to other family members. Editing withdraws the previous plan.'}</p>
    {Boolean(error) && <Failure error={error} />}<Button type="submit" disabled={busy || !dirty}>{busy ? (zh ? '正在保存…' : 'Saving…') : (zh ? '保存资料' : 'Save context')}</Button>
    {dirty && <Button type="button" disabled={busy} variant="ghost" onClick={() => { setDraft(null); setError(undefined); void notes.mutate(); }}>{zh ? '放弃修改并重新加载' : 'Discard edits and reload'}</Button>}
  </form>;
}
