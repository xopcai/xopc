import { CalendarClock, Moon, Pencil, Play } from 'lucide-react';
import { useState } from 'react';
import useSWR from 'swr';

import { Button } from '@/components/ui/button';
import { Select, SelectOption } from '@/components/ui/popover-select';
import { Skeleton } from '@/components/ui/skeleton';
import { formatMediumDateTime } from '@/lib/date-formatters';
import { showToast } from '@/lib/toast';
import { DreamingScheduleDialog } from './dreaming-schedule-dialog';
import { formatDreamingRunTime, formatDreamingSchedule, formatTimezone } from './dreaming-schedule-format';
import {
  fetchDreaming,
  runDreaming,
  updateDreamingSettings,
  type DreamingMode,
  type DreamingRun,
  type DreamingSettings,
} from './user-context-api';

type Phase = DreamingRun['phase'];

const COMMON_TIMEZONES = [
  'UTC', 'Asia/Shanghai', 'Asia/Hong_Kong', 'Asia/Tokyo', 'Asia/Singapore',
  'Asia/Kolkata', 'Europe/London', 'Europe/Paris', 'America/New_York',
  'America/Chicago', 'America/Denver', 'America/Los_Angeles', 'Australia/Sydney',
] as const;

const PHASE_COPY = {
  zh: {
    light: ['快速整理', '整理近期产生的记忆信号。'],
    deep: ['深度巩固', '强化反复被证明有用的理解。'],
    rem: ['模式发现', '从跨任务证据中提出长期模式。'],
  },
  en: {
    light: ['Quick consolidation', 'Organizes recently created memory signals.'],
    deep: ['Deep consolidation', 'Strengthens understanding that repeatedly proves useful.'],
    rem: ['Pattern discovery', 'Proposes long-term patterns from evidence across tasks.'],
  },
} as const;

export function DreamingPanel({ language }: { language: 'en' | 'zh' }) {
  const zh = language === 'zh';
  const { data, error, isLoading, mutate } = useSWR('/api/you/dreaming', fetchDreaming);
  const [busy, setBusy] = useState<string | null>(null);
  const [editingPhase, setEditingPhase] = useState<Phase | null>(null);
  if (isLoading) return <Skeleton className="h-64 rounded-2xl" />;
  if (error || !data) return <div className="rounded-2xl border border-danger/25 bg-danger-soft p-5 text-sm text-danger">{zh ? '无法加载 Dreaming 状态' : 'Could not load Dreaming status'}</div>;

  const modeLabels: Record<DreamingMode, string> = zh
    ? { off: '关闭', observe: '只观察', review: '生成待确认建议', automatic: '自动应用高置信结果' }
    : { off: 'Off', observe: 'Observe only', review: 'Propose for review', automatic: 'Apply high-confidence results' };
  const readinessLabels: Record<string, string> = zh
    ? {
        insufficient_feedback: '还需要更多经过评价的回答', low_helpful_rate: '记忆帮助率尚未达标',
        high_record_error_rate: '记录错误率偏高', sensitive_feedback_detected: '近期出现敏感信息反馈',
        insufficient_dreaming_runs: '还需要更多稳定运行记录', high_dreaming_failure_rate: '后台整理失败率偏高',
      }
    : {
        insufficient_feedback: 'More evaluated responses are required', low_helpful_rate: 'Memory helpfulness is below the threshold',
        high_record_error_rate: 'Record error rate is too high', sensitive_feedback_detected: 'Recent sensitive-information feedback was detected',
        insufficient_dreaming_runs: 'More stable Dreaming runs are required', high_dreaming_failure_rate: 'Dreaming failure rate is too high',
      };

  const saveSettings = async (settings: DreamingSettings, busyKey: string) => {
    setBusy(busyKey);
    try {
      await updateDreamingSettings(settings);
      await mutate();
      return true;
    } catch (cause) {
      showToast({ type: 'error', title: 'Dreaming', message: cause instanceof Error ? cause.message : String(cause) });
      return false;
    } finally {
      setBusy(null);
    }
  };

  const run = async (phase: Phase) => {
    setBusy(`run:${phase}`);
    try {
      await runDreaming(phase);
      await mutate();
    } catch (cause) {
      showToast({ type: 'error', title: 'Dreaming', message: cause instanceof Error ? cause.message : String(cause) });
    } finally {
      setBusy(null);
    }
  };

  const timezoneOptions = [...new Set([data.settings.timezone, ...COMMON_TIMEZONES])];
  const phaseCopy = PHASE_COPY[language];

  return (
    <div id="you-panel-dreaming" role="tabpanel" aria-labelledby="you-tab-dreaming" className="space-y-6">
      <section>
        <h2 className="flex items-center gap-2 text-base font-semibold text-fg"><Moon className="size-4 text-accent" aria-hidden />Dreaming</h2>
        <p className="mt-1 max-w-2xl text-sm leading-6 text-fg-muted">{zh ? '在空闲时整理已有证据、发现模式，并用可审计的方式提出或应用长期理解。' : 'Consolidates existing evidence during idle time, discovers patterns, and records every proposal or change.'}</p>
      </section>

      <section className="rounded-2xl border border-edge-subtle bg-surface-base p-5">
        <div className="grid gap-4 md:grid-cols-[minmax(0,1fr)_16rem]">
          <div><h3 className="text-sm font-semibold text-fg">{zh ? '运行模式' : 'Operating mode'}</h3><p className="mt-1 text-xs leading-5 text-fg-muted">{zh ? `当前生效：${modeLabels[data.config.mode]} · 写入级别：${data.config.writeDisposition}` : `Effective: ${modeLabels[data.config.mode]} · write disposition: ${data.config.writeDisposition}`}</p></div>
          <Select value={data.settings.mode} disabled={busy !== null} onChange={(event) => void saveSettings({ ...data.settings, mode: event.target.value as DreamingMode }, 'mode')}>{Object.entries(modeLabels).map(([value, label]) => <SelectOption key={value} value={value}>{label}</SelectOption>)}</Select>
        </div>
        {data.settings.mode === 'automatic' && !data.readiness.ready ? <div className="mt-4 rounded-xl border border-warning/25 bg-warning-soft/35 px-4 py-3"><p className="text-sm font-medium text-fg">{zh ? '自动写入暂时降级为待确认' : 'Automatic writes are temporarily downgraded to review'}</p><p className="mt-1 text-xs leading-5 text-fg-muted">{data.readiness.reasons.map((reason) => readinessLabels[reason] ?? reason).join(zh ? '；' : '; ')}</p></div> : null}
      </section>

      <section>
        <div className="flex flex-wrap items-end justify-between gap-3">
          <div><h3 className="flex items-center gap-2 text-sm font-semibold text-fg"><CalendarClock className="size-4 text-fg-muted" />{zh ? '运行计划' : 'Schedule'}</h3><p className="mt-1 text-xs text-fg-muted">{formatTimezone(data.settings.timezone, language)}</p></div>
          <div className="w-full sm:w-64"><Select value={data.settings.timezone} disabled={busy !== null} onChange={(event) => void saveSettings({ ...data.settings, timezone: event.target.value }, 'timezone')}>{timezoneOptions.map((timezone) => <SelectOption key={timezone} value={timezone}>{formatTimezone(timezone, language)}</SelectOption>)}</Select></div>
        </div>
        <div className="mt-3 grid gap-3 lg:grid-cols-3">
          {(['light', 'deep', 'rem'] as const).map((phase) => {
            const settings = data.settings.phases[phase];
            const runtime = data.config.phases[phase];
            const [title, description] = phaseCopy[phase];
            const scheduled = settings.enabled && data.config.enabled;
            return (
              <article key={phase} className="flex min-h-52 flex-col rounded-2xl border border-edge bg-surface-panel p-4">
                <div className="flex items-start justify-between gap-3"><div><p className="text-xs font-semibold uppercase tracking-wide text-accent">{phase}</p><h4 className="mt-1 text-sm font-semibold text-fg">{title}</h4></div><span className={scheduled ? 'text-xs text-success' : 'text-xs text-fg-subtle'}>{scheduled ? (zh ? '已启用' : 'Enabled') : settings.enabled ? (zh ? '随模式暂停' : 'Paused by mode') : (zh ? '已暂停' : 'Paused')}</span></div>
                <p className="mt-2 text-xs leading-5 text-fg-muted">{description}</p>
                <div className="mt-4 rounded-xl bg-surface-muted px-3 py-3"><p className="text-sm font-medium text-fg">{formatDreamingSchedule(settings.schedule, language)}</p><p className="mt-1 text-xs text-fg-muted">{zh ? '下次运行：' : 'Next run: '}{scheduled ? formatDreamingRunTime(runtime.nextRunsAt[0], language, data.settings.timezone) : (zh ? '已暂停' : 'Paused')}</p></div>
                <div className="mt-auto flex gap-2 pt-4"><Button type="button" variant="secondary" className="flex-1" disabled={busy !== null} onClick={() => setEditingPhase(phase)}><Pencil className="size-3.5" />{zh ? '编辑计划' : 'Edit'}</Button><Button type="button" variant="ghost" className="flex-1" disabled={!data.config.enabled || busy !== null} onClick={() => void run(phase)}><Play className="size-3.5" />{zh ? '立即运行' : 'Run now'}</Button></div>
              </article>
            );
          })}
        </div>
      </section>

      <section><h3 className="text-sm font-semibold text-fg">{zh ? '最近运行' : 'Recent runs'}</h3>{data.runs.length ? <div className="mt-3 divide-y divide-edge overflow-hidden rounded-xl border border-edge bg-surface-panel">{data.runs.map((run) => <div key={run.runId} className="flex flex-wrap items-center justify-between gap-3 px-4 py-3"><div><p className="text-sm font-medium uppercase text-fg">{run.phase} · {run.mode}</p><p className="mt-1 text-xs text-fg-muted">{run.reason ?? run.status}</p></div><div className="text-right text-xs text-fg-subtle"><p>{run.status}</p><p>{formatMediumDateTime(Date.parse(run.startedAt), language)}</p></div></div>)}</div> : <p className="mt-3 rounded-xl bg-surface-muted px-4 py-3 text-sm text-fg-muted">{zh ? '还没有运行记录。' : 'No runs yet.'}</p>}</section>

      {editingPhase ? <DreamingScheduleDialog open phase={editingPhase} value={data.settings.phases[editingPhase]} language={language} saving={busy === `schedule:${editingPhase}`} onOpenChange={(open) => { if (!open) setEditingPhase(null); }} onSave={async (value) => { const saved = await saveSettings({ ...data.settings, phases: { ...data.settings.phases, [editingPhase]: value } }, `schedule:${editingPhase}`); if (saved) setEditingPhase(null); }} /> : null}
    </div>
  );
}
