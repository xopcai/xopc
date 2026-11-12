import * as Dialog from '@radix-ui/react-dialog';
import { CalendarClock, Plus, X } from 'lucide-react';
import { useRef, useState, type FormEvent } from 'react';
import useSWR from 'swr';

import { Button } from '@/components/ui/button';
import { DateTimePicker } from '@/components/ui/date-time-picker';
import { Select, SelectOption } from '@/components/ui/popover-select';
import { Skeleton } from '@/components/ui/skeleton';
import { TimePicker } from '@/components/ui/time-picker';
import type { Automation, AutomationSchedule } from '@/features/automations/automation-api';
import { automationNextRunLabel, automationTriggerLabel, isCompletedOneTimeTask } from '@/features/automations/automation-display';
import { buildInput, formFromAutomation, initialForm, type FormState } from '@/features/automations/automation-form';
import { messages } from '@/i18n/messages';
import { fetchJson } from '@/lib/fetch';
import { apiUrl } from '@/lib/url';
import { useGatewayStore } from '@/stores/gateway-store';
import { formatPersonalScheduleTime } from './personal-task-time';

const path = '/api/personal-agent/schedules';
const fieldClass = 'w-full rounded-lg border border-edge bg-surface-base px-3 py-2 text-sm text-fg focus-visible:outline-2 focus-visible:outline-accent';
type PersonalSchedule = Automation & { action: Extract<Automation['action'], { kind: 'personal_task' }> };
type ScheduleInput = { name: string; instruction: string; locale: 'zh' | 'en'; schedule: AutomationSchedule };

function scheduleRequest<T>(suffix = '', method?: string, input?: object) {
  return fetchJson<{ payload: T }>(apiUrl(path + suffix), { method, body: input ? JSON.stringify(input) : undefined });
}

export function PersonalSchedules({ scope, visible, zh }: { scope: string; visible: boolean; zh: boolean }) {
  const identity = useGatewayStore(state => state.conversationId);
  const language = zh ? 'zh' : 'en';
  const { automations: labels, cron } = messages(language);
  const { data, error, mutate } = useSWR(visible && scope !== 'new' ? [path, scope, identity] : null,
    () => scheduleRequest<PersonalSchedule[]>(), { refreshInterval: 15_000 });
  const [editor, setEditor] = useState<PersonalSchedule | 'new' | null>(null);
  const items = [...(data?.payload ?? [])].sort((a, b) =>
    (a.state.nextRunAtMs ?? Infinity) - (b.state.nextRunAtMs ?? Infinity) || b.updatedAtMs - a.updatedAtMs);
  return <section className="space-y-1" aria-label={zh ? '定时任务' : 'Scheduled tasks'}>
    <div className="flex items-center justify-between gap-2 px-2">
      <h3 className="flex items-center gap-2 text-xs font-semibold text-fg-muted">
        {zh ? '定时任务' : 'Scheduled tasks'}
        {!data && !error && visible ? <Skeleton className="h-2.5 w-10" /> : null}
      </h3>
      <Button type="button" variant="ghost" className="h-8 gap-1 px-2 text-xs" disabled={scope === 'new'} onClick={() => setEditor('new')}>
        <Plus className="size-4" aria-hidden />{zh ? '新建' : 'New'}
      </Button>
    </div>
    {error ? <button type="button" onClick={() => void mutate()} className="px-2 py-2 text-sm text-accent-fg underline">
      {zh ? '加载失败，重试' : 'Loading failed. Try again'}
    </button> : null}
    {items.length ? <ul className="space-y-0.5">
      {items.map(item => <li key={item.id}>
        <button type="button" onClick={() => setEditor(item)}
          className="flex w-full min-w-0 items-start gap-2.5 rounded-xl px-2 py-2 text-left hover:bg-surface-hover focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-accent">
          <span className="mt-0.5 grid size-5 shrink-0 place-items-center text-fg-muted"><CalendarClock className="size-4" aria-hidden /></span>
          <span className="min-w-0 flex-1">
            <span className="block truncate text-sm leading-5 font-medium text-fg" title={item.name}>{item.name}</span>
            <span className="flex items-center gap-1.5 text-xs leading-5 text-fg-muted">
              <span className="truncate">{item.trigger.kind === 'schedule' && item.trigger.schedule.kind === 'once'
                ? labels.trigger.once : automationTriggerLabel(item.trigger, labels, cron, language)}</span>
              <span aria-hidden>·</span>
              <span className="shrink-0 text-fg-subtle">{isCompletedOneTimeTask(item)
                ? (zh ? '已触发' : 'Triggered')
                : !item.enabled ? labels.paused
                  : item.state.nextRunAtMs ? formatPersonalScheduleTime(item.state.nextRunAtMs, zh)
                    : automationNextRunLabel(item, labels, language)}</span>
            </span>
          </span>
        </button>
      </li>)}
    </ul> : null}
    {editor ? <PersonalScheduleDialog key={editor === 'new' ? 'new' : editor.id}
      zh={zh} schedule={editor === 'new' ? undefined : editor} onClose={() => setEditor(null)}
      onSaved={() => { void mutate(); setEditor(null); }} /> : null}
  </section>;
}

function PersonalScheduleDialog({ zh, schedule, onClose, onSaved }: {
  zh: boolean; schedule?: PersonalSchedule; onClose: () => void; onSaved: () => void;
}) {
  const language = zh ? 'zh' : 'en';
  const labels = messages(language).automations;
  const [form, setForm] = useState(() => {
    if (!schedule) return initialForm;
    const saved = formFromAutomation(schedule);
    const weekdays = /^([0-9]+) ([0-9]+) \* \* 1-5$/.exec(saved.cronExpr);
    return { ...saved, instruction: schedule.action.instruction,
      time: weekdays ? `${weekdays[2].padStart(2, '0')}:${weekdays[1].padStart(2, '0')}` : saved.time };
  });
  const weekdays = /^([0-9]+) ([0-9]+) \* \* 1-5$/.exec(form.cronExpr);
  const [mode, setMode] = useState<FormState['triggerMode'] | 'weekdays'>(() =>
    form.triggerMode === 'cron' && weekdays ? 'weekdays' : form.triggerMode);
  const [busy, setBusy] = useState(false);
  const submitting = useRef(false);
  const [error, setError] = useState('');
  const update = (patch: Partial<FormState>) => setForm(previous => ({ ...previous, ...patch }));
  const suffix = schedule ? `/${encodeURIComponent(schedule.id)}` : '';

  async function act(operation: () => Promise<unknown>) {
    if (submitting.current) return;
    submitting.current = true;
    setBusy(true);
    setError('');
    try { await operation(); onSaved(); }
    catch (cause) { setError(cause instanceof Error ? cause.message : labels.feedback.actionFailed); }
    finally { submitting.current = false; setBusy(false); }
  }

  function save(event: FormEvent) {
    event.preventDefault();
    void act(async () => {
      if (mode === 'once' && !(new Date(form.onceAt).getTime() > Date.now())) throw new Error(labels.experience.futureTime);
      const trigger = buildInput({ ...form, triggerMode: mode === 'weekdays' ? 'weekly' : mode,
        weekday: mode === 'weekdays' ? '1-5' : form.weekday }).trigger;
      if (trigger.kind !== 'schedule') return;
      const input: ScheduleInput = { name: form.name, instruction: form.instruction, locale: language, schedule: trigger.schedule };
      if (schedule) await scheduleRequest(suffix, 'PATCH', { ...input, expectedRevision: schedule.updatedAtMs });
      else await scheduleRequest('', 'POST', input);
    });
  }

  return <Dialog.Root open onOpenChange={open => { if (!open && !busy) onClose(); }}>
    <Dialog.Portal>
      <Dialog.Overlay className="fixed inset-0 z-[110] bg-black/45" />
      <Dialog.Content onKeyDown={event => event.stopPropagation()}
        className="xopc-dialog-content fixed left-1/2 top-1/2 z-[111] flex h-[min(36rem,calc(100dvh-2rem))] w-[min(32rem,calc(100vw-2rem))] -translate-x-1/2 -translate-y-1/2 flex-col overflow-hidden rounded-2xl border border-edge bg-surface-overlay shadow-popover outline-none">
        <header className="flex shrink-0 items-center justify-between border-b border-edge-subtle px-5 py-3">
          <Dialog.Title className="font-semibold text-fg">{schedule ? (zh ? '编辑定时任务' : 'Edit scheduled task') : (zh ? '新建定时任务' : 'New scheduled task')}</Dialog.Title>
          <Dialog.Close asChild><Button type="button" variant="ghost" className="size-9 p-0" disabled={busy} aria-label={zh ? '关闭' : 'Close'}><X className="size-4" /></Button></Dialog.Close>
        </header>
        <Dialog.Description className="sr-only">{zh ? '指定 Personal Agent 要做的事和执行时间。' : 'Choose what your Personal Agent should do and when.'}</Dialog.Description>
        <form onSubmit={save} className="flex min-h-0 flex-1 flex-col">
          <div className="min-h-0 flex-1 space-y-4 overflow-y-auto p-5">
            <fieldset disabled={busy} className="space-y-4">
              <label className="grid gap-1.5 text-sm">{labels.form.name}<input required maxLength={100} className={fieldClass} value={form.name} onChange={e => update({ name: e.target.value })} /></label>
              <label className="grid gap-1.5 text-sm">{zh ? '要做什么' : 'What should the agent do?'}<textarea required maxLength={50000} rows={3} className={fieldClass} value={form.instruction} onChange={e => update({ instruction: e.target.value })} /></label>
              <label className="grid gap-1.5 text-sm">{zh ? '频率' : 'Repeat'}<Select value={mode} onChange={e => setMode(e.target.value as typeof mode)}>
                <SelectOption value="once">{labels.trigger.once}</SelectOption>
                <SelectOption value="daily">{labels.trigger.daily}</SelectOption>
                <SelectOption value="weekdays">{zh ? '工作日' : 'Weekdays'}</SelectOption>
                <SelectOption value="weekly">{labels.trigger.weekly}</SelectOption>
                {form.triggerMode === 'interval' ? <SelectOption value="interval">{zh ? '固定间隔' : 'Fixed interval'}</SelectOption> : null}
                {form.triggerMode === 'cron' && !weekdays ? <SelectOption value="cron">{zh ? '自定义' : 'Custom'}</SelectOption> : null}
              </Select></label>
              {mode === 'once' ? <DateTimePicker label={labels.form.onceAt} disabled={busy} value={form.onceAt} defaultTime={form.time} onChange={onceAt => update({ onceAt })} />
                : mode === 'cron' ? <label className="grid gap-1.5 text-sm">{zh ? '定时规则' : 'Cron expression'}<input required className={fieldClass} value={form.cronExpr} onChange={e => update({ cronExpr: e.target.value })} /></label>
                : mode === 'interval' ? <div className="grid grid-cols-2 gap-3">
                  <label className="grid gap-1.5 text-sm">{zh ? '间隔' : 'Interval'}<input type="number" required min="1" className={fieldClass} value={form.intervalValue} onChange={e => update({ intervalValue: e.target.value })} /></label>
                  <label className="grid gap-1.5 text-sm">{zh ? '单位' : 'Unit'}<Select value={form.intervalUnit} onChange={e => update({ intervalUnit: e.target.value as FormState['intervalUnit'] })}>
                    <SelectOption value="minute">{zh ? '分钟' : 'Minutes'}</SelectOption><SelectOption value="hour">{zh ? '小时' : 'Hours'}</SelectOption>
                    <SelectOption value="day">{zh ? '天' : 'Days'}</SelectOption><SelectOption value="week">{zh ? '周' : 'Weeks'}</SelectOption>
                  </Select></label>
                </div>
                : <div className="grid gap-1.5 text-sm"><span>{labels.form.time}</span><TimePicker disabled={busy} value={form.time} onChange={time => update({ time })} ariaLabel={labels.form.time} /></div>}
              {mode === 'weekly' ? <label className="grid gap-1.5 text-sm">{labels.form.day}<Select value={form.weekday} onChange={e => update({ weekday: e.target.value })}>
                {(['sunday', 'monday', 'tuesday', 'wednesday', 'thursday', 'friday', 'saturday'] as const).map((day, i) => <SelectOption key={day} value={String(i)}>{labels.weekdays[day]}</SelectOption>)}
              </Select></label> : null}
              {mode !== 'interval' ? <p className="text-xs text-fg-muted">{mode === 'once' ? initialForm.timezone : form.timezone || initialForm.timezone}</p> : null}
            </fieldset>
            {error ? <p role="alert" className="text-sm text-danger">{error}</p> : null}
          </div>
          <footer className="flex shrink-0 flex-wrap items-center justify-between gap-2 border-t border-edge-subtle px-5 py-3">
            <div className="flex flex-wrap gap-1">
              {schedule && !isCompletedOneTimeTask(schedule) ? <Button type="button" variant="ghost" disabled={busy} onClick={() => void act(() => scheduleRequest(suffix, 'PATCH', { enabled: !schedule.enabled, expectedRevision: schedule.updatedAtMs }))}>
                {schedule.enabled ? (zh ? '暂停' : 'Pause') : (zh ? '恢复' : 'Resume')}
              </Button> : null}
              {schedule ? <Button type="button" variant="ghost" disabled={busy} onClick={() => void act(() => scheduleRequest(`${suffix}/run`, 'POST'))}>{zh ? '立即运行' : 'Run now'}</Button> : null}
            </div>
            <Button type="submit" variant="primary" disabled={busy || !form.name.trim() || !form.instruction.trim()}>{zh ? '保存' : 'Save'}</Button>
          </footer>
        </form>
      </Dialog.Content>
    </Dialog.Portal>
  </Dialog.Root>;
}
