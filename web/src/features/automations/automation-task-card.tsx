import { useEffect, useRef, useState } from 'react';
import * as Dialog from '@radix-ui/react-dialog';
import useSWR, { mutate } from 'swr';
import { CalendarClock, ChevronDown, MessageCircle, Pencil, X } from 'lucide-react';
import { Link, useNavigate } from 'react-router-dom';

import { fetchChatAgents } from '@/features/chat/agent-selection/chat-agents-api';
import { ModelSelector } from '@/features/chat/model/model-selector';
import { Button } from '@/components/ui/button';
import { FormField } from '@/components/ui/form-field';
import { Select, SelectOption } from '@/components/ui/popover-select';
import { Skeleton } from '@/components/ui/skeleton';
import { TimePicker } from '@/components/ui/time-picker';
import { messages } from '@/i18n/messages';
import { automationApi, type Automation } from './automation-api';
import { automationNextRunLabel, automationTriggerLabel, isCompletedOneTimeTask } from './automation-display';
import { openAutomationConfigurationChat } from './automation-create-navigation';
import { buildInput, formFromAutomation, initialForm, type FormState } from './automation-form';
import { scheduledRunPreview } from './schedule-preview';
import { automationIntervalMs } from './automation-display';

export async function refreshAutomationViews() {
  await mutate(key => typeof key === 'string' ? key.startsWith('automation') : Array.isArray(key) && typeof key[0] === 'string' && key[0].startsWith('automation'));
}

const inputClass = 'w-full rounded-lg border border-edge bg-surface-base px-3 py-2 text-sm text-fg focus-visible:outline-accent';

export function AutomationEditDialog({ automation, projectId, language, onClose, onCreated }: {
  automation?: Automation;
  projectId?: string;
  language: 'zh' | 'en';
  onClose: () => void;
  onCreated?: (automation: Automation) => void;
}) {
  const { data: agents, error: agentsError } = useSWR('automation-chat-agents', fetchChatAgents);
  const descriptionRef = useRef<HTMLTextAreaElement>(null);
  const [returnFocus] = useState(() => document.activeElement instanceof HTMLElement ? document.activeElement : null);
  const [snapshot, setSnapshot] = useState(automation);
  const [initial, setInitial] = useState(() => automation ? formFromAutomation(automation) : {
    ...initialForm, projectId: projectId ?? '', safetyMode: 'auto_apply' as const,
  });
  const [form, setForm] = useState(initial);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [conflict, setConflict] = useState(false);
  const zh = language === 'zh';
  const update = (patch: Partial<FormState>) => setForm(previous => ({ ...previous, ...patch }));
  const requestClose = () => {
    if (busy) return;
    if (JSON.stringify(form) !== JSON.stringify(initial) && !window.confirm(zh ? '放弃尚未保存的修改？' : 'Discard unsaved changes?')) return;
    onClose();
  };
  const save = async () => {
    setBusy(true); setError(''); setConflict(false);
    try {
      if (form.triggerMode === 'once' && (!form.onceAt || !Number.isFinite(new Date(form.onceAt).getTime()) || new Date(form.onceAt).getTime() <= Date.now())) throw new Error(zh ? '请选择未来的运行时间。' : 'Choose a future run time.');
      if (snapshot && snapshot.action.kind !== 'agent') throw new Error(zh ? '请在任务页编辑此类型任务。' : 'Edit this task type on the task page.');
      if (['daily', 'weekly'].includes(form.triggerMode) && !/^(?:[01]\d|2[0-3]):[0-5]\d$/.test(form.time)) throw new Error(zh ? '请选择有效的运行时间。' : 'Choose a valid run time.');
      if (form.triggerMode === 'interval' && automationIntervalMs(form.intervalValue, form.intervalUnit) < 60000) throw new Error(zh ? '运行间隔至少为一分钟。' : 'Use an interval of at least one minute.');
      scheduledRunPreview(form);
      const name = form.name.trim() || form.instruction.trim().split('\n')[0].slice(0, 80);
      const input = buildInput({ ...form, name });
      if (snapshot && snapshot.action.kind === 'agent') {
        await automationApi.update(snapshot.id, {
          expectedRevision: snapshot.updatedAtMs, name,
          action: { ...snapshot.action, instruction: form.instruction.trim(), agentId: form.agentId.trim() || undefined, model: form.model.trim() || undefined },
          trigger: input.trigger, conversationMode: form.conversationMode,
          delivery: { ...snapshot.delivery, notificationPolicy: form.notificationPolicy },
        });
      } else {
        const result = await automationApi.create({ ...input, enabled: true });
        onCreated?.(result.automation);
      }
      await refreshAutomationViews();
      onClose();
    } catch (err) {
      setConflict((err as { status?: number })?.status === 409);
      setError((err as { status?: number })?.status === 409
        ? (zh ? '任务已在其他地方更新，请核对最新设置后再保存。' : 'This task changed elsewhere. Review the latest settings before saving.')
        : err instanceof Error ? err.message : String(err));
    } finally { setBusy(false); }
  };
  const loadLatest = async () => {
    if (!snapshot || !window.confirm(zh ? '载入最新设置将替换当前未保存的修改，是否继续？' : 'Loading the latest settings replaces your unsaved edits. Continue?')) return;
    setBusy(true);
    try {
      const { automation: latest } = await automationApi.get(snapshot.id);
      const next = formFromAutomation(latest);
      setSnapshot(latest); setInitial(next); setForm(next); setError(''); setConflict(false);
    } catch { setError(zh ? '暂时无法载入最新设置，请重试。' : 'Could not load the latest settings. Try again.'); }
    finally { setBusy(false); }
  };
  let timezoneLabel = form.timezone || (zh ? '默认时区' : 'Default timezone');
  try {
    timezoneLabel = zh && form.timezone === 'Asia/Shanghai' ? '中国时间'
      : new Intl.DateTimeFormat(zh ? 'zh-CN' : 'en-US', { timeZone: timezoneLabel, timeZoneName: 'shortGeneric' }).formatToParts(new Date()).find(part => part.type === 'timeZoneName')?.value || timezoneLabel;
  } catch { /* The expanded timezone field displays validation errors. */ }
  let nextPreview = '';
  try {
    const next = scheduledRunPreview(form)[0];
    if (next && form.timezone !== Intl.DateTimeFormat().resolvedOptions().timeZone) nextPreview = `${zh ? '你这里的下次时间：' : 'Next run in your timezone: '}${new Date(next).toLocaleString(zh ? 'zh-CN' : 'en-US', { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit', timeZoneName: 'short' })}`;
  } catch { /* Validation is shown on save. */ }
  const rowClass = 'flex min-h-12 items-center justify-between gap-4 border-b border-edge last:border-b-0';
  const choiceClass = 'min-h-10 w-32 shrink-0 justify-end border-0 bg-transparent py-2 pl-3 pr-0 text-right text-sm text-fg-muted shadow-none';
  return <Dialog.Root open onOpenChange={open => { if (!open) requestClose(); }}><Dialog.Portal>
    <Dialog.Overlay className="fixed inset-0 z-65 bg-scrim" />
    <Dialog.Content onCloseAutoFocus={event => { event.preventDefault(); if (returnFocus?.isConnected) returnFocus.focus(); }} onOpenAutoFocus={event => { event.preventDefault(); descriptionRef.current?.focus(); }} style={{ height: `min(${snapshot ? 600 : 440}px, calc(100dvh - 2rem))` }} className="fixed left-1/2 top-1/2 z-66 flex w-[min(42.5rem,calc(100%-2rem))] -translate-x-1/2 -translate-y-1/2 flex-col overflow-hidden rounded-2xl border border-edge bg-surface-overlay shadow-popover">
      <header className="flex shrink-0 items-center justify-between px-5 pb-3 pt-5"><Dialog.Title className="text-base font-semibold text-fg">{snapshot ? (zh ? '编辑定时任务' : 'Edit scheduled task') : (zh ? '设定定时任务' : 'Schedule a task')}</Dialog.Title><Dialog.Close asChild><Button variant="ghost" disabled={busy} aria-label={zh ? '关闭' : 'Close'}><X className="size-4" /></Button></Dialog.Close></header>
      <Dialog.Description className="sr-only">{zh ? '描述要做的事，选择重复频率和时间。' : 'Describe the task and choose its frequency and time.'}</Dialog.Description>
      <div className="min-h-0 flex-1 space-y-4 overflow-y-auto px-5 pb-3">
        {snapshot ? <input aria-label={zh ? '任务名称' : 'Task name'} className="w-full rounded-xl border border-edge bg-transparent px-4 py-3 text-sm text-fg focus-visible:outline-accent" value={form.name} onChange={event => update({ name: event.target.value })} /> : null}
        <label className="block"><span className="sr-only">{zh ? '要做什么' : 'What should happen'}</span><textarea ref={descriptionRef} aria-label={zh ? '任务说明' : 'Task description'} placeholder={zh ? '希望定期帮你做什么？' : 'What would you like done regularly?'} className="block h-32 w-full resize-none rounded-xl border border-edge bg-transparent px-4 py-3 text-sm leading-6 text-fg placeholder:text-fg-subtle focus-visible:outline-accent" value={form.instruction} onChange={event => update({ instruction: event.target.value })} /></label>
        <section aria-label={zh ? '运行时间' : 'Schedule'} className="rounded-xl border border-edge px-4">
          <div className={rowClass}><span className="text-sm text-fg">{zh ? '重复' : 'Repeat'}</span><Select aria-label={zh ? '重复' : 'Repeat'} className={choiceClass} value={form.triggerMode} onChange={event => update({ triggerMode: event.target.value as FormState['triggerMode'] })}>
            <SelectOption value="once">{zh ? '仅一次' : 'Once'}</SelectOption><SelectOption value="daily">{zh ? '每天' : 'Daily'}</SelectOption><SelectOption value="weekly">{zh ? '每周' : 'Weekly'}</SelectOption><SelectOption value="interval">{zh ? '固定间隔' : 'At intervals'}</SelectOption><SelectOption value="cron">{zh ? '自定义' : 'Custom'}</SelectOption>
            {!['once', 'daily', 'weekly', 'interval', 'cron'].includes(form.triggerMode) ? <SelectOption value={form.triggerMode}>{zh ? '保持当前触发方式' : 'Keep current trigger'}</SelectOption> : null}
          </Select></div>
          {['daily', 'weekly'].includes(form.triggerMode) ? <div className={rowClass}><span className="text-sm text-fg">{zh ? '时间' : 'Time'}</span><div className="flex min-w-0 items-center gap-2 text-sm text-fg-muted"><span className="truncate text-xs">{timezoneLabel}</span><TimePicker value={form.time} onChange={time => update({ time })} ariaLabel={zh ? '时间' : 'Time'} className="w-auto" triggerClassName="w-auto border-0 bg-transparent px-0 shadow-none" /></div></div> : null}
          {form.triggerMode === 'weekly' ? <div className={rowClass}><span className="text-sm text-fg">{zh ? '星期' : 'Day'}</span><Select aria-label={zh ? '星期' : 'Day'} className={choiceClass} value={form.weekday} onChange={event => update({ weekday: event.target.value })}>{Object.entries(zh ? { '1': '星期一', '2': '星期二', '3': '星期三', '4': '星期四', '5': '星期五', '6': '星期六', '0': '星期日' } : { '1': 'Monday', '2': 'Tuesday', '3': 'Wednesday', '4': 'Thursday', '5': 'Friday', '6': 'Saturday', '0': 'Sunday' }).map(([value, label]) => <SelectOption key={value} value={value}>{label}</SelectOption>)}</Select></div> : null}
          {form.triggerMode === 'once' ? <div className={rowClass}><label htmlFor="automation-once-at" className="text-sm text-fg">{zh ? '时间' : 'Time'}</label><input id="automation-once-at" type="datetime-local" className="min-w-0 bg-transparent py-3 text-sm text-fg-muted" value={form.onceAt} onInput={event => update({ onceAt: event.currentTarget.value })} onChange={event => update({ onceAt: event.target.value })} /></div> : null}
          {form.triggerMode === 'cron' ? <div className={rowClass}><label htmlFor="automation-cron" className="text-sm text-fg">{zh ? '时间规则' : 'Schedule'}</label><input id="automation-cron" className="min-w-0 bg-transparent py-3 text-right text-sm text-fg-muted" value={form.cronExpr} onChange={event => update({ cronExpr: event.target.value })} /></div> : null}
          {form.triggerMode === 'interval' ? <div className={rowClass}><label htmlFor="automation-interval" className="text-sm text-fg">{zh ? '每隔' : 'Every'}</label><div className="flex items-center gap-3"><input id="automation-interval" type="number" min="1" aria-label={zh ? '间隔数值' : 'Interval value'} className="w-16 bg-transparent text-right text-sm text-fg-muted" value={form.intervalValue} onChange={event => update({ intervalValue: event.target.value })} /><Select aria-label={zh ? '间隔单位' : 'Interval unit'} className={choiceClass} value={form.intervalUnit} onChange={event => update({ intervalUnit: event.target.value as FormState['intervalUnit'] })}><SelectOption value="minute">{zh ? '分钟' : 'Minutes'}</SelectOption><SelectOption value="hour">{zh ? '小时' : 'Hours'}</SelectOption><SelectOption value="day">{zh ? '天' : 'Days'}</SelectOption><SelectOption value="week">{zh ? '周' : 'Weeks'}</SelectOption></Select></div></div> : null}
        </section>
        {nextPreview ? <p className="text-xs text-fg-muted" role="status">{nextPreview}</p> : null}
        {form.triggerMode === 'once' ? <p className="text-xs text-fg-muted">{zh ? '按你所在时区输入，换时区后仍在同一时刻运行。' : 'Enter your local time. Changing timezone keeps the same instant.'}</p> : null}
        <details className="group"><summary className="flex w-fit cursor-pointer list-none items-center gap-1 rounded-md px-1 py-2 text-sm text-fg-muted focus-visible:outline-accent">{zh ? '高级' : 'Advanced'}<ChevronDown className="size-3.5 transition-transform group-open:rotate-180" aria-hidden /></summary><div className="mt-2 grid gap-4 pb-2">
          {!snapshot ? <FormField label={zh ? '任务名称（可选）' : 'Task name (optional)'}><input className={inputClass} value={form.name} onChange={event => update({ name: event.target.value })} placeholder={zh ? '根据说明自动命名' : 'Named from your description'} /></FormField> : null}
          <FormField label={zh ? '时区' : 'Timezone'}><input className={inputClass} value={form.timezone ?? ''} placeholder="Asia/Shanghai" onChange={event => update({ timezone: event.target.value })} /></FormField>
          <FormField label={zh ? '执行助手' : 'Run with'}><Select aria-label={zh ? '执行助手' : 'Run with'} className={inputClass} value={form.agentId} onChange={event => update({ agentId: event.target.value })}>
            <SelectOption value="">{zh ? '默认助手' : 'Default assistant'}</SelectOption>
            {form.agentId && !agents?.items.some(agent => agent.id === form.agentId) ? <SelectOption value={form.agentId}>{form.agentId}</SelectOption> : null}
            {agents?.items.map(agent => <SelectOption key={agent.id} value={agent.id}>{agent.name || agent.id}</SelectOption>)}
          </Select><p className="mt-1 text-xs text-fg-muted">{agentsError ? (zh ? '暂时无法加载助手，请稍后重试。' : 'Could not load assistants. Try again later.') : zh ? '从下次运行生效，切换时衔接最近的执行结果。' : 'Applies to the next run, carrying over the latest result when switching.'}</p></FormField>
          <FormField label={zh ? '使用模型' : 'Model'}><ModelSelector value={form.model} onChange={model => update({ model })} allowEmpty placeholder={messages(language).automations.form.defaultModel} searchPlaceholder={messages(language).automations.form.searchModels} noMatches={messages(language).automations.form.noModels} emptyLabel={zh ? '默认模型' : 'Default model'} ariaLabel={zh ? '使用模型' : 'Model'} /></FormField>
          <FormField label={zh ? '运行上下文' : 'Run context'}><Select className={inputClass} value={form.conversationMode} onChange={event => update({ conversationMode: event.target.value as FormState['conversationMode'] })}><SelectOption value="new_session">{zh ? '每次独立运行' : 'Independent runs'}</SelectOption><SelectOption value="continuous">{zh ? '延续之前的运行' : 'Continue previous runs'}</SelectOption></Select></FormField>
          <FormField label={zh ? '通知我' : 'Notify me'}><Select className={inputClass} value={form.notificationPolicy} onChange={event => update({ notificationPolicy: event.target.value as FormState['notificationPolicy'] })}><SelectOption value="attention">{zh ? '需要关注时' : 'When attention is needed'}</SelectOption><SelectOption value="all">{zh ? '每次完成时' : 'After every run'}</SelectOption><SelectOption value="none">{zh ? '不通知' : 'Never'}</SelectOption></Select></FormField>
        </div></details>
        {error ? <div role="alert" className="space-y-2 text-sm text-danger"><p>{error}</p>{conflict ? <Button variant="secondary" disabled={busy} onClick={() => void loadLatest()}>{zh ? '载入最新设置' : 'Load latest settings'}</Button> : null}<p>{zh ? '内容已保留，请核对后重试。' : 'Your edits are preserved. Review and retry.'}</p></div> : null}
      </div>
      <footer className="flex shrink-0 justify-end gap-2 px-5 pb-5 pt-3"><Button variant="ghost" className="rounded-full bg-surface-base px-4" disabled={busy} onClick={requestClose}>{zh ? '取消' : 'Cancel'}</Button><Button variant="primary" className="rounded-full px-4 disabled:bg-surface-active disabled:text-fg-subtle disabled:opacity-100" disabled={busy || !form.instruction.trim()} onClick={() => void save()}>{busy ? (zh ? '保存中…' : 'Saving…') : snapshot ? (zh ? '保存' : 'Save') : (zh ? '创建' : 'Create')}</Button></footer>
    </Dialog.Content>
  </Dialog.Portal></Dialog.Root>;
}

export function AutomationTaskCard({ automationId, language, inConfiguration = false }: { automationId: string; language: 'zh' | 'en'; inConfiguration?: boolean }) {
  const navigate = useNavigate();
  const [editing, setEditing] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const { data, error: loadError, isLoading, mutate: reload } = useSWR(['automation-card', automationId], () => automationApi.get(automationId), { refreshInterval: 5000, shouldRetryOnError: false });
  const zh = language === 'zh';
  const task = data?.automation;
  const labels = messages(language);
  if (isLoading && !task) return <Skeleton className="my-3 h-20 w-full rounded-xl" />;
  if (loadError || !task) return <div className="my-3 rounded-xl border border-edge p-4 text-sm text-fg-muted"><p>{zh ? '任务已删除或暂时无法读取。' : 'This task was deleted or is unavailable.'}</p><button type="button" className="mt-2 underline" onClick={() => void reload()}>{zh ? '重试' : 'Retry'}</button></div>;
  const continueChat = async () => {
    setBusy(true); setError('');
    try { navigate(await openAutomationConfigurationChat({ automationId: task.id })); }
    catch (err) { setError(err instanceof Error ? err.message : String(err)); }
    finally { setBusy(false); }
  };
  return <div className="my-3 overflow-hidden rounded-xl border border-edge bg-surface-panel" data-product-delivery="automation">
    <div className="flex flex-wrap items-center gap-3 p-3"><CalendarClock className="size-6 shrink-0 text-fg-muted" aria-hidden /><div className="min-w-0 flex-1"><p className="truncate text-sm font-medium text-fg">{task.name}</p><p className="mt-1 text-xs text-fg-muted">{automationTriggerLabel(task.trigger, labels.automations, labels.cron, language)}{task.trigger.kind === 'schedule' && task.trigger.schedule.kind === 'cron' && task.trigger.schedule.tz ? ` · ${task.trigger.schedule.tz}` : ''} · {isCompletedOneTimeTask(task) ? (zh ? '已完成' : 'Completed') : task.enabled ? labels.automations.enabled : labels.automations.paused}</p><p className="mt-1 text-xs text-fg-subtle">{task.enabled ? `${zh ? '下次：' : 'Next: '}${automationNextRunLabel(task, labels.automations, language)}` : isCompletedOneTimeTask(task) ? (zh ? '这项一次性任务已完成' : 'This one-time task is complete') : (zh ? '恢复后将按计划运行' : 'Resume to run on schedule')}</p></div>
      {!task.management && task.action.kind === 'agent' ? <Button variant="ghost" onClick={() => setEditing(true)}><Pencil className="size-4" aria-hidden />{zh ? '编辑' : 'Edit'}</Button> : null}
      {!inConfiguration && !task.management && task.action.kind !== 'system' ? <Button variant="ghost" disabled={busy} onClick={() => void continueChat()}><MessageCircle className="size-4" aria-hidden />{zh ? '继续对话' : 'Continue in chat'}</Button> : null}
      <Link className="rounded-md border border-edge px-3 py-2 text-xs text-fg hover:bg-surface-hover" to={`/automations?automation=${encodeURIComponent(task.id)}`}>{zh ? '打开' : 'Open'}</Link>
    </div>
    {['failed', 'timeout'].includes(task.state.lastRunStatus ?? '') ? <p className="px-4 pb-3 text-xs text-fg-muted">{zh ? '上次运行未完成。可以在对话中说明“帮我修复”，再试运行。' : 'The last run did not finish. Ask in chat to fix it, then try again.'}</p> : null}
    {error ? <p role="alert" className="px-4 pb-3 text-sm text-danger">{error}</p> : null}
    {editing ? <AutomationEditDialog automation={task} language={language} onClose={() => setEditing(false)} /> : null}
  </div>;
}

export function AutomationConfigurationPanel({ conversationId, language, running }: { conversationId: string; language: 'zh' | 'en'; running?: boolean }) {
  const { data, error, mutate: reload } = useSWR(['automation-configuration', conversationId], () => automationApi.configuration(conversationId), { refreshInterval: 3000, shouldRetryOnError: false });
  useEffect(() => { if (!running) { void reload(); void refreshAutomationViews(); } }, [running, conversationId, reload]);
  if (error) return <button type="button" className="mb-4 text-sm text-fg-muted underline" onClick={() => void reload()}>{language === 'zh' ? '任务配置暂时无法读取，点击重试' : 'Task configuration unavailable. Retry'}</button>;
  if (!data) return <Skeleton className="mb-4 h-20 rounded-xl" />;
  if (data.deleted) return <p className="mb-4 text-sm text-fg-muted">{language === 'zh' ? '这个定时任务已删除，配置讨论仍可查看。' : 'This scheduled task was deleted. Its configuration discussion is preserved.'}</p>;
  return data.automation ? <AutomationTaskCard automationId={data.automation.id} language={language} inConfiguration /> : null;
}

export function AutomationContinueButton({ automationId, language, runId, variant = 'primary' }: { automationId: string; language: 'zh' | 'en'; runId?: string; variant?: 'primary' | 'secondary' | 'ghost' }) {
  const navigate = useNavigate();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const open = async () => {
    setBusy(true); setError('');
    try { navigate(await openAutomationConfigurationChat({ automationId, runId, prompt: runId ? (language === 'zh' ? '帮我看看这次为什么没有完成，并修复问题。' : 'Help me understand why this did not finish and fix the problem.') : undefined })); }
    catch (err) { setError(err instanceof Error ? err.message : String(err)); }
    finally { setBusy(false); }
  };
  return <span><Button variant={variant} disabled={busy} onClick={() => void open()}><MessageCircle className="size-4" aria-hidden />{runId ? (language === 'zh' ? '对话修复' : 'Fix in chat') : (language === 'zh' ? '继续对话' : 'Continue in chat')}</Button>{error ? <span role="alert" className="ml-2 text-xs text-danger">{error}</span> : null}</span>;
}
