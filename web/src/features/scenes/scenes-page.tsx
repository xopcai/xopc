import { ArrowLeft, CalendarDays, CirclePause, RefreshCw, Sparkles } from 'lucide-react';
import { useCallback, useEffect, useRef, useState, type FormEvent } from 'react';
import { Link, useBeforeUnload, useBlocker, useNavigate, useParams, useSearchParams } from 'react-router-dom';
import useSWR, { SWRConfig } from 'swr';

import { Button } from '@/components/ui/button';
import { Skeleton } from '@/components/ui/skeleton';
import { useLocaleStore } from '@/stores/locale-store';
import { useGatewayStore } from '@/stores/gateway-store';

import { sceneErrorText, sceneGet, sceneWrite, type SceneActivation, type SceneNotes, type SceneOutcome, type SceneRun, type SceneTemplate } from './api';
import { OutcomeCard } from './outcome-card';
import { ScheduleEditor } from './schedule-editor';
import { MailSourcePicker } from './mail-source-picker';
import { MailDeadlineEditor } from './mail-deadline-editor';

const fieldClass = 'min-h-11 w-full rounded-md border border-edge bg-surface-panel px-3 py-2 text-base text-fg focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent sm:text-sm';
const panelClass = 'min-w-0 rounded-xl border border-edge bg-surface-panel p-4 sm:p-6';
const labelClass = 'grid gap-2 text-sm font-medium text-fg';

function statusText(status: string, zh: boolean) {
  const labels: Record<string, [string, string]> = {
    needs_setup: ['需要设置', 'Needs setup'], active: ['已开启', 'Active'], paused: ['已暂停', 'Paused'],
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
    <h1 className="text-xl font-semibold text-fg">{zh ? '场景尚未开放' : 'Scenes are not available yet'}</h1>
    <p className="text-sm text-fg-muted">{sceneErrorText(error, zh)}</p>
    <Button asChild><Link to="/chat">{zh ? '返回对话' : 'Back to chat'}</Link></Button>
  </section>;
  return <div role="alert" className="space-y-3 rounded-xl border border-edge p-4"><p className="text-sm text-danger">{sceneErrorText(error, zh)}</p>
    {retry && <Button onClick={retry}><RefreshCw size={16} aria-hidden="true" />{zh ? '重新加载' : 'Reload'}</Button>}</div>;
}

function useDirtyGuard(dirty: boolean, zh: boolean) {
  useBeforeUnload(useCallback((event) => { if (dirty) { event.preventDefault(); event.returnValue = ''; } }, [dirty]));
  const blocker = useBlocker(dirty);
  useEffect(() => {
    if (blocker.state !== 'blocked') return;
    if (window.confirm(zh ? '有未保存的内容。放弃更改并离开？' : 'You have unsaved changes. Discard them and leave?')) blocker.proceed();
    else blocker.reset();
  }, [blocker, zh]);
}

export function ScenesPage() {
  const session = useGatewayStore((state) => state.conversationId);
  const expired = useGatewayStore((state) => state.tokenExpired);
  if (expired) return <Failure error={{ status: 401 }} />;
  return <SWRConfig key={session ?? 'anonymous'} value={{ provider: () => new Map() }}><SceneContent /></SWRConfig>;
}

function SceneContent() {
  const { activationId, templateKey } = useParams();
  return <main className="h-full overflow-y-auto bg-surface-panel p-4 sm:p-8"><div className="mx-auto max-w-3xl space-y-6">
    {templateKey ? <CreateScene key={templateKey} templateKey={templateKey} /> : activationId ? <SceneDetail key={activationId} id={activationId} /> : <SceneList />}
  </div></main>;
}

function SceneList() {
  const zh = useLocaleStore((state) => state.language) === 'zh';
  const [params, setParams] = useSearchParams();
  const cursor = params.get('after') ?? '';
  const templates = useSWR<{ templates: SceneTemplate[] }>('/templates', sceneGet);
  const mine = useSWR<{ activations: SceneActivation[]; nextCursor: string | null }>(`/activations?limit=20&afterId=${encodeURIComponent(cursor)}`, sceneGet);
  if (templates.error || mine.error) return <Failure error={templates.error ?? mine.error} retry={() => { void templates.mutate(); void mine.mutate(); }} />;
  if (!templates.data || !mine.data) return <Loading />;
  return <>
    <header className="space-y-2"><h1 className="text-balance text-xl font-semibold tracking-tight text-fg">{zh ? '场景' : 'Scenes'}</h1>
      <p className="text-sm text-fg-muted">{zh ? '把需要持续留意的事交给 AI，把时间留给自己。' : 'Let AI look after recurring needs, leaving more time for you.'}</p></header>
    <section className="space-y-3"><h2 className="text-base font-semibold text-fg">{zh ? '你想先轻松一点的事' : 'Where could you use a little help?'}</h2>
      <div className="grid gap-4 sm:grid-cols-2">{templates.data.templates.map((template) => <article key={`${template.key}:${template.version}`} className={`${panelClass} space-y-3`}>
        <Sparkles className="text-fg-muted" size={20} aria-hidden="true" /><h3 className="text-balance font-medium text-fg">{template.title}</h3>
        <p className="text-sm text-fg-muted">{template.description}</p><Button asChild><Link to={`/scenes/new/${encodeURIComponent(template.key)}?version=${encodeURIComponent(template.version)}`}>{zh ? '了解并开启' : 'Explore and start'}</Link></Button>
      </article>)}</div></section>
    <section className="space-y-3"><h2 className="text-base font-semibold text-fg">{zh ? '我的场景' : 'My scenes'}</h2>
      {mine.data.activations.length ? mine.data.activations.map((activation) => <Link key={activation.id} to={`/scenes/${activation.id}`} className={`${panelClass} block space-y-2 transition-colors hover:bg-surface-hover focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent`}>
        <p className="break-words font-medium text-fg">{activation.goal}</p><p className="text-sm text-fg-muted">{statusText(activation.status, zh)}</p>
      </Link>) : <div className={`${panelClass} space-y-2`}><CalendarDays aria-hidden="true" className="text-fg-muted" /><p className="text-fg">{zh ? '还没有开启场景' : 'No scenes yet'}</p><p className="text-sm text-fg-muted">{zh ? '从上面选择一件你希望 AI 帮忙照看的事。' : 'Choose something above that you would like AI to look after.'}</p></div>}
      <div className="flex gap-3">{cursor && <Button onClick={() => setParams({})}>{zh ? '返回第一页' : 'First page'}</Button>}{mine.data.nextCursor && <Button onClick={() => setParams({ after: mine.data!.nextCursor! })}>{zh ? '下一页' : 'Next page'}</Button>}</div>
    </section>
  </>;
}

function CreateScene({ templateKey }: { templateKey: string }) {
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
  useDirtyGuard(Boolean(goal) && !saved, zh);
  useEffect(() => { if (saved) navigate(savedId.current); }, [saved, navigate]);
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
  return <><Back zh={zh} /><header><h1 className="text-balance text-xl font-semibold text-fg">{manifest.title}</h1><p className="mt-2 text-sm text-fg-muted">{manifest.description}</p></header>
    <form onSubmit={(event) => void start(event)} className={`${panelClass} space-y-5`}>
      <fieldset disabled={busy || saved} className="space-y-5">
      <label className={labelClass}>{zh ? '希望它持续帮你做好什么？' : 'What should it keep helping you with?'}<textarea required maxLength={4000} rows={3} value={goal} onChange={(event) => setGoal(event.target.value)} className={fieldClass} autoComplete="off" /></label>
      {mail && <MailSourcePicker value={subjectId} disabled={busy || saved} zh={zh} onChange={(source) => { setAccountId(source.accountId); setSubjectId(source.id); setConfirmed(false); }} />}
      <p className="text-sm text-fg-muted">{zh ? '只准备草稿和建议，不发送消息、不执行外部写操作。开启后可设置检查时间，随时暂停。' : 'Prepares drafts and suggestions only. No messages or external writes. Set a review time after starting, and pause whenever you wish.'}</p>
      <label className="flex min-h-11 items-center gap-3 text-sm text-fg"><input required type="checkbox" className="ui-checkbox" checked={confirmed} onChange={(event) => setConfirmed(event.target.checked)} />{zh ? '确认以上范围，允许读取我提供的资料。' : 'I confirm this scope and allow reading the information I provide.'}</label>
      {Boolean(error) && <Failure error={error} />}<Button type="submit" variant="primary" disabled={busy || saved || (mail && !subjectId)}>{busy ? (zh ? '正在开启…' : 'Starting…') : (zh ? '开启场景' : 'Start scene')}</Button>
      </fieldset>
    </form></>;
}

function Back({ zh }: { zh: boolean }) {
  return <Button asChild variant="ghost"><Link to="/scenes"><ArrowLeft size={16} aria-hidden="true" />{zh ? '返回场景' : 'Back to scenes'}</Link></Button>;
}

function SceneDetail({ id }: { id: string }) {
  const zh = useLocaleStore((state) => state.language) === 'zh';
  const path = `/activations/${encodeURIComponent(id)}`;
  const detail = useSWR<{ activation: SceneActivation }>(path, sceneGet, { refreshInterval: 15000 });
  const runs = useSWR<{ runs: SceneRun[] }>(`${path}/runs?limit=20`, sceneGet, { refreshInterval: 5000 });
  const results = useSWR<{ outcomes: SceneOutcome[] }>(`/outcomes?limit=50&activationId=${encodeURIComponent(id)}`, sceneGet, { refreshInterval: 5000 });
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<unknown>();
  const [queued, setQueued] = useState(false);
  const checkKey = useRef<string | null>(null);
  const [notesDirty, setNotesDirty] = useState(false);
  const [scheduleDirty, setScheduleDirty] = useState(false);
  useDirtyGuard(notesDirty || scheduleDirty, zh);
  const act = async (check: boolean) => {
    if (!detail.data) return;
    setBusy(true); setError(undefined); setQueued(false);
    try {
      if (check) {
        checkKey.current ??= crypto.randomUUID();
        await sceneWrite(`${path}/checks`, 'POST', undefined, checkKey.current);
        checkKey.current = null; setQueued(true);
      } else await sceneWrite(path, 'PATCH', { expectedRevision: detail.data.activation.revision, status: detail.data.activation.status === 'active' ? 'paused' : 'active' });
      await Promise.all([detail.mutate(), runs.mutate(), results.mutate()]);
    } catch (reason) { setError(reason); } finally { setBusy(false); }
  };
  if (detail.error) return <><Back zh={zh} /><Failure error={detail.error} retry={() => void detail.mutate()} /></>;
  if (!detail.data) return <Loading />;
  const activation = detail.data.activation;
  return <><Back zh={zh} /><header className="space-y-3"><h1 className="break-words text-balance text-xl font-semibold text-fg">{activation.goal}</h1>
    <p className="text-sm text-fg-muted">{statusText(activation.status, zh)} · {activation.templateKey} · v{activation.templateVersion}</p>
    <p className="text-sm text-fg-muted">{zh ? '只准备建议和成果，不自动发送或写入外部系统。' : 'Prepares suggestions and results. Does not send or write to external systems.'}</p>
    <div className="flex flex-wrap gap-3"><Button variant="primary" disabled={busy || activation.status !== 'active'} onClick={() => void act(true)}>{busy ? (zh ? '处理中…' : 'Working…') : (zh ? '现在检查' : 'Check now')}</Button>
      {['active', 'paused', 'needs_setup'].includes(activation.status) && <Button disabled={busy} onClick={() => void act(false)}><CirclePause size={16} aria-hidden="true" />{activation.status === 'active' ? (zh ? '暂停场景' : 'Pause scene') : (zh ? '检查设置并恢复' : 'Review setup and resume')}</Button>}</div>
    {queued && <p role="status" className="text-sm text-fg-muted">{zh ? '检查已排队；没有新变化时不会生成新卡片。' : 'Check queued. No new card is created when nothing has changed.'}</p>}
  </header>{error && <Failure error={error} retry={() => { void detail.mutate(); setError(undefined); }} />}
    {activation.permissions.contextProviders.includes('user_notes') && <NotesEditor path={path} zh={zh} onDirty={setNotesDirty} onSaved={() => { void results.mutate(); void runs.mutate(); }} />}
    {activation.templateKey === 'mail-follow-up' ? <MailDeadlineEditor activation={activation} zh={zh} onDirty={setScheduleDirty} onChanged={() => { void results.mutate(); void runs.mutate(); }} /> : <ScheduleEditor activation={activation} zh={zh} onDirty={setScheduleDirty} />}
    <section className="space-y-3"><h2 className="text-base font-semibold text-fg">{zh ? '最近成果' : 'Recent results'}</h2>
      {results.error ? <Failure error={results.error} retry={() => void results.mutate()} /> : !results.data ? <Loading /> : results.data.outcomes.filter((item) => item.activationId === id).length === 0
        ? <p className="text-sm text-fg-muted">{zh ? '还没有新成果。提供资料后，可以先检查一次。' : 'No new results yet. Provide context and try a check.'}</p>
        : results.data.outcomes.map((item) => <OutcomeCard key={item.id} item={item} zh={zh} onChange={() => void results.mutate()} />)}
    </section>
    <section className="space-y-3"><h2 className="text-base font-semibold text-fg">{zh ? '检查记录' : 'Check history'}</h2>
      {runs.error ? <Failure error={runs.error} retry={() => void runs.mutate()} /> : !runs.data ? <Loading /> : runs.data.runs.length === 0 ? <p className="text-sm text-fg-muted">{zh ? '尚未执行检查。' : 'No checks yet.'}</p>
        : <ul className="divide-y divide-edge">{runs.data.runs.map((run) => <li key={run.id} className="flex flex-wrap justify-between gap-2 py-3 text-sm"><span className="text-fg">{statusText(run.status, zh)}{run.reason === 'empty_input' ? (zh ? '：请先提供资料' : ': provide context first') : ''}</span><time className="text-fg-muted" dateTime={new Date(run.createdAt).toISOString()}>{new Intl.DateTimeFormat(zh ? 'zh-CN' : 'en', { dateStyle: 'medium', timeStyle: 'short' }).format(run.createdAt)}</time></li>)}</ul>}
    </section></>;
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
    <p className="text-sm text-fg-muted">{zh ? '只用于这个场景，不会因此访问其他家庭成员的数据。修改资料会撤回旧计划。' : 'Used only in this scene. Does not grant access to other family members. Editing withdraws the previous plan.'}</p>
    {Boolean(error) && <Failure error={error} />}<Button type="submit" disabled={busy || !dirty}>{busy ? (zh ? '正在保存…' : 'Saving…') : (zh ? '保存资料' : 'Save context')}</Button>
    {dirty && <Button type="button" disabled={busy} variant="ghost" onClick={() => { setDraft(null); setError(undefined); void notes.mutate(); }}>{zh ? '放弃修改并重新加载' : 'Discard edits and reload'}</Button>}
  </form>;
}
