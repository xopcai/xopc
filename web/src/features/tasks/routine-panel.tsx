import { useState } from 'react';
import useSWR from 'swr';
import { RoutineSchema, type Routine, type RoutineCommandRequest, type ObservationState } from '@xopcai/gateway-contract';
import { Button } from '@/components/ui/button';
import { Skeleton } from '@/components/ui/skeleton';
import { fetchJson } from '@/lib/fetch';
import { apiUrl } from '@/lib/url';
import { HomeTaskReview } from './home-task-review';
function ScheduleFields({ time, setTime, day, setDay, zone, setZone, until, setUntil, zh }: {
    time: string;
    setTime(v: string): void;
    day: number;
    setDay(v: number): void;
    zone: string;
    setZone(v: string): void;
    until: string;
    setUntil(v: string): void;
    zh: boolean;
}) {
    return <div className="space-y-3">
    <div className="flex flex-wrap gap-1" role="group" aria-label={zh ? '执行日' : 'Run day'}>{[1, 2, 3, 4, 5, 6, 0].map(d => <Button key={d} type="button" variant={day === d ? 'secondary' : 'ghost'} aria-pressed={day === d} onClick={() => setDay(d)}>{zh ? `周${['日', '一', '二', '三', '四', '五', '六'][d]}` : ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'][d]}</Button>)}</div>
    <label className="block text-xs text-fg-muted">{zh ? '执行时间' : 'Run time'}<input className="mt-1 w-full rounded border border-edge bg-surface-inset p-2 text-sm text-fg" type="time" required value={time} onChange={e => setTime(e.target.value)}/></label>
    <label className="block text-xs text-fg-muted">{zh ? '时区' : 'Timezone'}<input className="mt-1 w-full rounded border border-edge bg-surface-inset p-2 text-sm text-fg" required value={zone} onChange={e => setZone(e.target.value)}/></label>
    <label className="block text-xs text-fg-muted">{zh ? '托管到期日（UTC）' : 'Agreement expiry (UTC)'}<input className="mt-1 w-full rounded border border-edge bg-surface-inset p-2 text-sm text-fg" type="date" required value={until} onChange={e => setUntil(e.target.value)}/></label>
  </div>;
}
function schedule(time: string, day: number, zone: string) { const [h, m] = time.split(':'); return { kind: 'cron' as const, expr: `${m} ${h} * * ${day}`, tz: zone }; }
export function RoutineAdoption({ topicId, trial, onUpdated, language }: {
    topicId: string;
    trial: ObservationState['topics'][number]['trials'][number];
    onUpdated(): void;
    language: 'zh' | 'en';
}) {
    const zh = language === 'zh';
    const [open, setOpen] = useState(false), [busy, setBusy] = useState(false), [error, setError] = useState('');
    const [time, setTime] = useState('17:00'), [day, setDay] = useState(5), [zone, setZone] = useState(Intl.DateTimeFormat().resolvedOptions().timeZone || 'UTC');
    const [until, setUntil] = useState(new Date(Date.now() + 90 * 86400000).toISOString().slice(0, 10));
    if (!trial.taskVersion)
        return null;
    return <div className="mt-2">
    <Button variant="secondary" aria-expanded={open} onClick={() => setOpen(!open)}>{zh ? '试做满意后，确认长期托管' : 'Confirm ongoing routine after reviewing the trial'}</Button>
    {open ? <form className="mt-3 space-y-3 rounded-lg border border-edge p-3" onSubmit={e => {
                e.preventDefault();
                setBusy(true);
                setError('');
                void fetchJson(apiUrl('/api/home/routines/adopt'), {
                    method: 'POST', body: JSON.stringify({ topicId, trialTaskId: trial.taskId, expectedTaskVersion: trial.taskVersion, idempotencyKey: crypto.randomUUID(),
                        schedule: schedule(time, day, zone), validUntil: Date.parse(`${until}T23:59:59Z`) }),
                }).then(v => { RoutineSchema.parse(v); setOpen(false); onUpdated(); }).catch(c => { setError(c instanceof Error ? c.message : String(c)); onUpdated(); }).finally(() => setBusy(false));
            }}>
      <p className="text-sm text-fg">{zh ? '每周期生成私人草稿，保留试做的目标、来源范围与验收标准，不自动发送或发布。仅本次的要求不纳入托管。只有试做验收通过才能启用。' : 'Each occurrence creates a private draft using the trial objective, source scope and acceptance criteria. No sending or publishing. One-off requirements are excluded. A verified trial is required.'}</p>
      <ScheduleFields {...{ time, setTime, day, setDay, zone, setZone, until, setUntil, zh }}/>
      {error ? <p role="alert" className="text-sm text-danger">{error}</p> : null}
      <Button type="submit" disabled={busy}>{zh ? '确认约定并启用' : 'Confirm agreement and enable'}</Button>
    </form> : null}
  </div>;
}
export function RoutinePanel({ routine: prop, language, onUpdated }: {
    routine: Routine;
    language: 'zh' | 'en';
    onUpdated(): void;
}) {
    const zh = language === 'zh';
    const [local, setLocal] = useState<Routine>(), [busy, setBusy] = useState(false), [error, setError] = useState(''), [taskId, setTaskId] = useState<string>();
    const [confirmEnd, setConfirmEnd] = useState(false), [config, setConfig] = useState(false);
    const parts = prop.schedule?.kind === 'cron' ? prop.schedule.expr.split(/\s+/) : [];
    const [time, setTime] = useState(parts.length === 5 ? `${parts[1].padStart(2, '0')}:${parts[0].padStart(2, '0')}` : '17:00'), [day, setDay] = useState(parts.length === 5 ? Number(parts[4]) : 5), [zone, setZone] = useState(prop.schedule?.kind === 'cron' ? prop.schedule.tz || 'UTC' : 'UTC');
    const [until, setUntil] = useState(new Date(prop.validUntil).toISOString().slice(0, 10));
    const routine = local && local.revision > prop.revision ? local : prop;
    const command = (command: RoutineCommandRequest['command']) => {
        if (busy)
            return;
        setBusy(true);
        setError('');
        void fetchJson(apiUrl(`/api/home/routines/${encodeURIComponent(routine.id)}/command`), {
            method: 'POST', body: JSON.stringify({ expectedRevision: routine.revision, idempotencyKey: crypto.randomUUID(), command }),
        }).then(v => { setLocal(RoutineSchema.parse(v)); onUpdated(); }).catch(c => { setError(c instanceof Error ? c.message : String(c)); onUpdated(); }).finally(() => setBusy(false));
    };
    const stateLabel = routine.status === 'active' ? (zh ? '已托管' : 'Active') : routine.status === 'paused' ? (zh ? '已暂停' : 'Paused') : (zh ? '已结束' : 'Ended');
    return <section className="mt-3 space-y-3 rounded-lg border border-edge p-3" aria-label={zh ? '托管与方法改进' : 'Routine and method improvements'}>
    <div className="flex flex-wrap items-center justify-between gap-2"><h3 className="text-sm font-semibold text-fg">{routine.title} · {stateLabel}</h3><span className="text-xs text-fg-muted">{zh ? '当前方法' : 'Current method'} v{routine.adoptedVersion}</span></div>
    <p className="text-xs text-fg-muted">{routine.schedule?.kind === 'cron' ? `${routine.schedule.expr} · ${routine.schedule.tz}` : routine.schedule?.kind === 'interval' ? `${routine.schedule.everyMs / 60000} min` : routine.schedule?.at} · {zh ? '到期' : 'Expires'} {new Date(routine.validUntil).toLocaleDateString(zh ? 'zh-CN' : 'en-US')}</p>
    <p className="text-xs text-fg-muted">{zh ? '每周期独立执行，生成私人草稿；暂停观察不暂停此项托管。' : 'Each occurrence runs independently and produces a private draft. Pausing observation does not pause this routine.'}</p>
    {error ? <p role="alert" className="text-sm text-danger">{error}</p> : null}
    {routine.status !== 'ended' ? <div className="flex flex-wrap gap-2"><Button variant="secondary" disabled={busy} onClick={() => command({ kind: routine.status === 'active' ? 'pause' : 'resume' })}>{routine.status === 'active' ? (zh ? '暂停托管' : 'Pause') : (zh ? '恢复托管' : 'Resume')}</Button><Button variant="ghost" onClick={() => setConfig(!config)}>{zh ? '调整时间与期限' : 'Adjust schedule and expiry'}</Button><Button variant="ghost" onClick={() => setConfirmEnd(true)}>{zh ? '结束托管' : 'End routine'}</Button></div> : null}
    {confirmEnd ? <div className="space-y-2"><p className="text-sm text-fg">{zh ? '结束后停止未来执行，并请求取消正在运行的本项任务。历史结果保留。' : 'Stop future occurrences and request cancellation of the current routine task. Keep past results.'}</p><Button disabled={busy} onClick={() => { command({ kind: 'end' }); setConfirmEnd(false); }}>{zh ? '确认结束' : 'Confirm end'}</Button><Button variant="ghost" onClick={() => setConfirmEnd(false)}>{zh ? '取消' : 'Cancel'}</Button></div> : null}
    {config && routine.status !== 'ended' ? <form className="space-y-3" onSubmit={e => { e.preventDefault(); command({ kind: 'configure', schedule: schedule(time, day, zone), validUntil: Date.parse(`${until}T23:59:59Z`) }); setConfig(false); }}><ScheduleFields {...{ time, setTime, day, setDay, zone, setZone, until, setUntil, zh }}/><Button type="submit" disabled={busy}>{zh ? '确认调整' : 'Confirm changes'}</Button></form> : null}
    <details><summary className="text-xs text-accent-fg">{zh ? '方法、验证与版本' : 'Methods, validation and versions'}</summary><p className="mt-2 text-xs text-fg-muted">{zh ? '新增长期反馈会形成候选；先验证，再采用。一次验证通过不代表长期稳定性已证实。' : 'Standing feedback creates candidates. Validate before adoption. One passing validation does not establish long-term reliability.'}</p>
      {routine.methods.map(m => <div key={m.version} className="mt-3 space-y-2 border-l border-edge pl-3"><p className="text-sm text-fg">v{m.version}{m.version === routine.adoptedVersion ? (zh ? ' · 使用中' : ' · Current') : ''} · {m.status}</p>{m.additions.map((a, i) => <p key={i} className="whitespace-pre-wrap break-words text-xs text-fg-muted">{a}</p>)}
        {m.validationTaskId ? <><Button variant="ghost" onClick={() => setTaskId(m.validationTaskId!)}>{zh ? '查看验证任务' : 'Review validation'}</Button><span className="text-xs text-fg-muted">{m.validation === 'passed' ? (zh ? '本次验证通过' : 'This validation passed') : m.validation === 'failed' ? (zh ? '验证未通过' : 'Validation did not pass') : (zh ? '等待验证结果' : 'Awaiting verification')}</span></> : null}
        {routine.status !== 'ended' && m.status === 'candidate' ? <Button disabled={busy} onClick={() => command({ kind: 'validate', version: m.version })}>{zh ? '先验证改进' : 'Validate improvement'}</Button> : null}
        {routine.status !== 'ended' && m.validation === 'passed' && m.status === 'validating' ? <Button disabled={busy} onClick={() => command({ kind: 'adopt_method', version: m.version })}>{zh ? '后续使用这个改进' : 'Use improvement for future runs'}</Button> : null}
        {routine.status !== 'ended' && ['candidate', 'validating'].includes(m.status) ? <Button variant="ghost" disabled={busy} onClick={() => command({ kind: 'reject_method', version: m.version })}>{zh ? '保留原方法' : 'Keep original method'}</Button> : null}
        {routine.status !== 'ended' && m.status === 'approved' && m.version !== routine.adoptedVersion ? <Button variant="ghost" disabled={busy} onClick={() => command({ kind: 'rollback', version: m.version })}>{zh ? '回退到此版本' : 'Restore this version'}</Button> : null}
      </div>)}
    </details>
    {routine.executions.length ? <details><summary className="text-xs text-accent-fg">{zh ? '后续执行结果' : 'Subsequent outcomes'}</summary>{routine.executions.map(e => <div className="mt-2 flex flex-wrap items-center gap-2 text-xs text-fg-muted" key={e.runId}><span>v{e.version} · {e.status} · {e.verdict || (zh ? '未验收' : 'Not verified')}</span><Button variant="ghost" onClick={() => setTaskId(e.taskId)}>{zh ? '查看结果与验收' : 'Review result'}</Button></div>)}</details> : null}
    {taskId ? <HomeTaskReview taskId={taskId} language={language} onComplete={onUpdated}/> : null}
    <a className="inline-block text-xs text-accent-fg" href={`#/automations?automation=${encodeURIComponent(routine.automationId)}`}>{zh ? '在自动化中管理' : 'Manage in automations'} ›</a>
  </section>;
}
export function RoutineAutomationDetails({ routineId, language }: {
    routineId: string;
    language: 'zh' | 'en';
}) {
    const state = useSWR(`/api/home/routines`, url => fetchJson<{
        items: Routine[];
    }>(apiUrl(url)), { refreshInterval: 5000 });
    if (state.isLoading)
        return <Skeleton className="h-48 w-full"/>;
    if (state.error)
        return <p role="alert" className="text-sm text-danger">{String(state.error)}</p>;
    const routine = state.data?.items.find(r => r.id === routineId);
    return routine ? <RoutinePanel routine={routine} language={language} onUpdated={() => void state.mutate()}/> : null;
}
