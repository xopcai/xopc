import { useRef, useState } from 'react';
import { Link } from 'react-router-dom';

import { Button } from '@/components/ui/button';
import { automationApi, type Automation } from '@/features/automations/automation-api';
import { automationTriggerLabel, isCompletedOneTimeTask } from '@/features/automations/automation-display';
import { messages } from '@/i18n/messages';

export function TaskSchedulePanel({ schedules, language, onEdit, onUpdated }: {
  schedules: Automation[];
  language: 'zh' | 'en';
  onEdit: (automation: Automation) => void;
  onUpdated: (automation: Automation) => void;
}) {
  const zh = language === 'zh';
  const labels = messages(language);
  const [pendingId, setPendingId] = useState<string | null>(null);
  const pending = useRef(false);
  const [error, setError] = useState<string | null>(null);
  const dateTime = (value: number) => new Date(value).toLocaleString(zh ? 'zh-CN' : 'en-US', {
    year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', timeZoneName: 'short',
  });
  async function cancel(automation: Automation) {
    if (pending.current) return;
    pending.current = true;
    setPendingId(automation.id);
    setError(null);
    try {
      const result = await automationApi.update(automation.id, { enabled: false, expectedRevision: automation.updatedAtMs });
      onUpdated(result.automation);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : labels.automations.feedback.actionFailed);
    } finally {
      pending.current = false;
      setPendingId(null);
    }
  }
  return <section aria-label={zh ? '执行时间' : 'Execution schedule'} className="rounded-xl border border-edge bg-surface-panel p-4">
    <h2 className="text-sm font-semibold text-fg">{zh ? '执行时间' : 'Execution schedule'}</h2>
    <div className="mt-3 space-y-4">{schedules.map((automation) => {
      const schedule = automation.trigger.kind === 'schedule' ? automation.trigger.schedule : null;
      const completed = isCompletedOneTimeTask(automation);
      const canEdit = !automation.management || automation.management.editable.includes('trigger');
      const canCancel = !automation.management || automation.management.editable.includes('enabled');
      return <article key={automation.id} className="space-y-2 text-sm text-fg">
        <div className="flex flex-wrap items-center justify-between gap-2"><span className="break-words font-medium">{automation.name}</span><span className="text-xs text-fg-muted">{completed ? (zh ? '已执行' : 'Completed') : automation.enabled ? (zh ? '已启用' : 'Enabled') : (zh ? '已取消定时执行' : 'Scheduling disabled')}</span></div>
        <p>{schedule?.kind === 'once' ? `${zh ? '单次执行：' : 'Run once: '}${dateTime(Date.parse(schedule.at))}` : automationTriggerLabel(automation.trigger, labels.automations, labels.cron, language)}</p>
        {schedule?.kind === 'cron' ? <p className="text-xs text-fg-muted">{zh ? '执行时区：' : 'Schedule timezone: '}{schedule.tz || (zh ? '服务所在电脑时区' : 'Server timezone')}</p> : null}
        <p className="text-fg-muted">{zh ? '下次执行：' : 'Next run: '}{completed ? (zh ? '已执行，无后续计划' : 'Completed; no upcoming run') : !automation.enabled ? (zh ? '已取消，不再自动执行' : 'Disabled; no automatic runs') : automation.state.nextRunAtMs !== undefined ? dateTime(automation.state.nextRunAtMs) : (zh ? '暂无后续执行' : 'No upcoming run')}</p>
        <div className="flex flex-wrap items-center gap-2">
          {canEdit ? <Button variant="secondary" disabled={pendingId !== null} onClick={() => onEdit(automation)}>{zh ? '修改时间' : 'Edit schedule'}</Button> : null}
          {automation.enabled && canCancel ? <Button variant="ghost" disabled={pendingId !== null} onClick={() => void cancel(automation)}>{pendingId === automation.id ? (zh ? '正在取消…' : 'Cancelling…') : (zh ? '取消定时执行' : 'Cancel schedule')}</Button> : null}
          <Button asChild variant="ghost"><Link to={`/automations?automation=${encodeURIComponent(automation.id)}`}>{zh ? '查看自动化' : 'View automation'}</Link></Button>
        </div>
      </article>;
    })}</div>
    {error ? <p role="alert" className="mt-3 text-sm text-danger">{error}</p> : null}
  </section>;
}
