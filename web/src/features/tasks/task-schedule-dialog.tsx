import * as Dialog from '@radix-ui/react-dialog';
import { X } from 'lucide-react';
import { useRef, useState, type FormEvent } from 'react';
import { Link } from 'react-router-dom';

import { Button } from '@/components/ui/button';
import { Select, SelectOption } from '@/components/ui/popover-select';
import { TimePicker } from '@/components/ui/time-picker';
import { automationApi, type Automation } from '@/features/automations/automation-api';
import { buildAutomationEditInput, buildInput, formFromAutomation, initialForm, type FormState } from '@/features/automations/automation-form';
import { SchedulePreview } from '@/features/automations/schedule-preview';
import { messages } from '@/i18n/messages';

const inputClass = 'w-full rounded-lg border border-edge bg-surface-base px-3 py-2 text-sm text-fg focus-visible:outline-2 focus-visible:outline-accent';

export function TaskScheduleDialog({ taskId, taskTitle, projectId, executorAgentId, language, onClose, onCreated, automation: editing }: {
  automation?: Automation;
  taskId: string;
  taskTitle: string;
  projectId?: string;
  executorAgentId?: string;
  language: 'zh' | 'en';
  onClose: () => void;
  onCreated: (automation: Automation) => void;
}) {
  const zh = language === 'zh';
  const labels = messages(language).automations;
  const [form, setForm] = useState<FormState>(() => editing ? formFromAutomation(editing) : ({
    ...initialForm,
    name: taskTitle,
    projectId: projectId ?? '',
    actionMode: 'task_command',
    taskId,
    agentId: executorAgentId ?? '',
    triggerMode: 'once',
    timezone: Intl.DateTimeFormat().resolvedOptions().timeZone || 'UTC',
  }));
  const [created, setCreated] = useState<Automation | null>(null);
  const [busy, setBusy] = useState(false);
  const submitting = useRef(false);
  const [error, setError] = useState<string | null>(null);
  const update = (patch: Partial<FormState>) => setForm((previous) => ({ ...previous, ...patch }));

  async function submit(event: FormEvent) {
    event.preventDefault();
    if (submitting.current || created) return;
    setError(null);
    if (!form.name.trim() || (!editing && !executorAgentId)) return;
    if (form.triggerMode === 'once' && (!Number.isFinite(new Date(form.onceAt).getTime()) || new Date(form.onceAt).getTime() <= Date.now())) {
      setError(labels.experience.futureTime);
      return;
    }
    submitting.current = true;
    setBusy(true);
    try {
      const trigger = editing ? buildAutomationEditInput(editing, form).trigger : buildInput(form).trigger;
      const { automation } = editing
        ? await automationApi.update(editing.id, {
          trigger,
          ...(!editing.management ? { name: form.name.trim(), delivery: { ...editing.delivery, notificationPolicy: form.notificationPolicy } } : {}),
          ...(!editing.management || editing.management.editable.includes('enabled') ? { enabled: true } : {}),
          expectedRevision: editing.updatedAtMs,
        })
        : await automationApi.create({ ...buildInput(form), enabled: true });
      setCreated(automation);
      onCreated(automation);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : labels.feedback.actionFailed);
    } finally {
      submitting.current = false;
      setBusy(false);
    }
  }

  return <Dialog.Root open onOpenChange={(open) => { if (!open && !submitting.current) onClose(); }}>
    <Dialog.Portal>
      <Dialog.Overlay className="fixed inset-0 z-[110] bg-black/45" />
      <Dialog.Content className="xopc-dialog-content fixed left-1/2 top-1/2 z-[111] flex h-[min(38rem,calc(100dvh-2rem))] w-[min(32rem,calc(100vw-2rem))] -translate-x-1/2 -translate-y-1/2 flex-col overflow-hidden rounded-2xl border border-edge bg-surface-overlay shadow-popover outline-none">
        <header className="flex shrink-0 items-center justify-between gap-3 border-b border-edge-subtle px-5 py-4">
          <Dialog.Title className="text-base font-semibold text-fg">{editing ? (zh ? '修改执行时间' : 'Edit execution schedule') : (zh ? '设置执行时间' : 'Set execution time')}</Dialog.Title>
          <Dialog.Close asChild><Button variant="ghost" className="size-9 p-0" disabled={busy} aria-label={zh ? '关闭' : 'Close'}><X className="size-4" /></Button></Dialog.Close>
        </header>
        <Dialog.Description className="sr-only">{zh ? '为当前任务创建定时或周期自动化。' : 'Create a scheduled or recurring automation for this task.'}</Dialog.Description>
        {created ? <>
          <div className="min-h-0 flex-1 space-y-4 overflow-y-auto p-5">
            <p role="status" className="text-sm font-medium text-fg">{editing ? (zh ? '执行时间已更新' : 'Schedule updated') : (zh ? '执行时间已设置' : 'Schedule created')}</p>
            <p className="break-words text-sm text-fg-muted">{created.name}</p>
            <Button asChild variant="primary"><Link to={`/automations?automation=${encodeURIComponent(created.id)}`}>{zh ? '查看自动化' : 'View automation'}</Link></Button>
          </div>
          <footer className="shrink-0 border-t border-edge-subtle p-4"><Button onClick={onClose}>{zh ? '完成' : 'Done'}</Button></footer>
        </> : <form onSubmit={(event) => void submit(event)} className="flex min-h-0 flex-1 flex-col">
          <div className="min-h-0 flex-1 space-y-4 overflow-y-auto p-5">
            <p className="break-words text-sm text-fg-muted">{zh ? '执行任务：' : 'Task: '}{taskTitle}</p>
            <fieldset disabled={busy} className="space-y-4">
              <label className="grid gap-2 text-sm text-fg">{labels.form.name}<input required readOnly={Boolean(editing?.management)} className={inputClass} value={form.name} onChange={(event) => update({ name: event.target.value })} /></label>
              <label className="grid gap-2 text-sm text-fg">{labels.form.trigger}<Select value={form.triggerMode} onChange={(event) => update({ triggerMode: event.target.value as FormState['triggerMode'] })}>
                {editing?.trigger.kind === 'schedule' && editing.trigger.schedule.kind === 'interval' ? <SelectOption value="interval">{zh ? '固定间隔' : 'Fixed interval'}</SelectOption> : null}
                {editing?.trigger.kind === 'schedule' && editing.trigger.schedule.kind === 'cron' ? <SelectOption value="cron">{zh ? '自定义规则' : 'Custom schedule'}</SelectOption> : null}
                <SelectOption value="once">{labels.trigger.once}</SelectOption><SelectOption value="daily">{labels.trigger.daily}</SelectOption><SelectOption value="weekly">{labels.trigger.weekly}</SelectOption>
              </Select></label>
              {form.triggerMode === 'once' ? <label className="grid gap-2 text-sm text-fg">{labels.form.onceAt}<input required type="datetime-local" className={inputClass} value={form.onceAt} onChange={(event) => update({ onceAt: event.target.value })} /></label>
                : ['daily', 'weekly'].includes(form.triggerMode) ? <div className="grid gap-2 text-sm text-fg"><span>{labels.form.time}</span><TimePicker disabled={busy} value={form.time} onChange={(time) => update({ time })} ariaLabel={labels.form.time} /></div> : null}
              {form.triggerMode === 'weekly' ? <label className="grid gap-2 text-sm text-fg">{labels.form.day}<Select value={form.weekday} onChange={(event) => update({ weekday: event.target.value })}>
                {(['sunday', 'monday', 'tuesday', 'wednesday', 'thursday', 'friday', 'saturday'] as const).map((day, index) => <SelectOption key={day} value={String(index)}>{labels.weekdays[day]}</SelectOption>)}
              </Select></label> : null}
              {form.triggerMode === 'cron' ? <label className="grid gap-2 text-sm text-fg">{zh ? '定时规则' : 'Cron expression'}<input required className={inputClass} value={form.cronExpr} onChange={(event) => update({ cronExpr: event.target.value })} /></label> : null}
              {form.triggerMode === 'interval' ? <div className="grid grid-cols-2 gap-3"><label className="grid gap-2 text-sm text-fg">{zh ? '执行间隔' : 'Interval'}<input required type="number" min="1" className={inputClass} value={form.intervalValue} onChange={(event) => update({ intervalValue: event.target.value })} /></label><label className="grid gap-2 text-sm text-fg">{zh ? '单位' : 'Unit'}<Select value={form.intervalUnit} onChange={(event) => update({ intervalUnit: event.target.value as FormState['intervalUnit'] })}><SelectOption value="minute">{zh ? '分钟' : 'Minutes'}</SelectOption><SelectOption value="hour">{zh ? '小时' : 'Hours'}</SelectOption><SelectOption value="day">{zh ? '天' : 'Days'}</SelectOption><SelectOption value="week">{zh ? '周' : 'Weeks'}</SelectOption></Select></label></div> : null}
              <SchedulePreview form={form} onChange={update} language={language} />
              <label className="grid gap-2 text-sm text-fg">{labels.draft.notifications}<Select disabled={Boolean(editing?.management)} value={form.notificationPolicy} onChange={(event) => update({ notificationPolicy: event.target.value as FormState['notificationPolicy'] })}>
                <SelectOption value="attention">{labels.draft.notifyAttention}</SelectOption><SelectOption value="all">{labels.draft.notifyAll}</SelectOption><SelectOption value="none">{labels.draft.notifyNone}</SelectOption>
              </Select></label>
            </fieldset>
            {!editing && !executorAgentId ? <p role="alert" className="text-sm text-danger">{zh ? '请先为任务指定执行 Agent。' : 'Assign an executor agent to the task first.'}</p> : null}
            {error ? <p role="alert" className="text-sm text-danger">{error}</p> : null}
          </div>
          <footer className="flex shrink-0 justify-end gap-2 border-t border-edge-subtle p-4">
            <Button type="button" variant="ghost" disabled={busy} onClick={onClose}>{zh ? '取消' : 'Cancel'}</Button>
            <Button type="submit" variant="primary" disabled={busy || (!editing && !executorAgentId) || !form.name.trim() || (form.triggerMode === 'once' && !form.onceAt)}>{busy ? (zh ? '正在保存…' : 'Saving…') : editing ? (editing.enabled ? (zh ? '保存修改' : 'Save changes') : (zh ? '保存并启用' : 'Save and enable')) : (zh ? '创建自动化' : 'Create automation')}</Button>
          </footer>
        </form>}
      </Dialog.Content>
    </Dialog.Portal>
  </Dialog.Root>;
}
