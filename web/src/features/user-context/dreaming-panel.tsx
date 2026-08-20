import { Moon, Play } from 'lucide-react';
import { useState } from 'react';
import useSWR from 'swr';

import { Button } from '@/components/ui/button';
import { Select, SelectOption } from '@/components/ui/popover-select';
import { Skeleton } from '@/components/ui/skeleton';
import { formatMediumDateTime } from '@/lib/date-formatters';
import { showToast } from '@/lib/toast';
import {
  fetchDreaming,
  runDreaming,
  updateDreamingMode,
  type DreamingMode,
  type DreamingRun,
} from './user-context-api';

export function DreamingPanel({ language }: { language: 'en' | 'zh' }) {
  const zh = language === 'zh';
  const { data, error, isLoading, mutate } = useSWR('/api/you/dreaming', fetchDreaming);
  const [busy, setBusy] = useState<string | null>(null);
  if (isLoading) return <Skeleton className="h-64 rounded-2xl" />;
  if (error || !data) return <div className="rounded-2xl border border-danger/25 bg-danger-soft p-5 text-sm text-danger">{zh ? '无法加载 Dreaming 状态' : 'Could not load Dreaming status'}</div>;

  const modeLabels: Record<DreamingMode, string> = zh
    ? { off: '关闭', observe: '只观察', review: '生成待确认建议', automatic: '自动应用高置信结果' }
    : { off: 'Off', observe: 'Observe only', review: 'Propose for review', automatic: 'Apply high-confidence results' };
  const readinessLabels: Record<string, string> = zh
    ? {
        insufficient_feedback: '还需要更多经过评价的回答',
        low_helpful_rate: '记忆帮助率尚未达标',
        high_record_error_rate: '记录错误率偏高',
        sensitive_feedback_detected: '近期出现敏感信息反馈',
        insufficient_dreaming_runs: '还需要更多稳定运行记录',
        high_dreaming_failure_rate: '后台整理失败率偏高',
      }
    : {
        insufficient_feedback: 'More evaluated responses are required',
        low_helpful_rate: 'Memory helpfulness is below the threshold',
        high_record_error_rate: 'Record error rate is too high',
        sensitive_feedback_detected: 'Recent sensitive-information feedback was detected',
        insufficient_dreaming_runs: 'More stable Dreaming runs are required',
        high_dreaming_failure_rate: 'Dreaming failure rate is too high',
      };

  const saveMode = async (mode: DreamingMode) => {
    setBusy('mode');
    try {
      const result = await updateDreamingMode(mode);
      await mutate({ ...data, config: result.config }, { revalidate: true });
    } catch (cause) {
      showToast({ type: 'error', title: 'Dreaming', message: cause instanceof Error ? cause.message : String(cause) });
    } finally { setBusy(null); }
  };
  const run = async (phase: DreamingRun['phase']) => {
    setBusy(phase);
    try {
      await runDreaming(phase);
      await mutate();
    } catch (cause) {
      showToast({ type: 'error', title: 'Dreaming', message: cause instanceof Error ? cause.message : String(cause) });
    } finally { setBusy(null); }
  };

  return (
    <div id="you-panel-dreaming" role="tabpanel" aria-labelledby="you-tab-dreaming" className="space-y-6">
      <section>
        <h2 className="flex items-center gap-2 text-base font-semibold text-fg"><Moon className="size-4 text-accent" aria-hidden />Dreaming</h2>
        <p className="mt-1 max-w-2xl text-sm leading-6 text-fg-muted">{zh ? '在空闲时整理已有证据、发现模式，并用可审计的方式提出或应用长期理解。' : 'Consolidates existing evidence during idle time, discovers patterns, and records every proposal or change.'}</p>
      </section>
      <section className="rounded-2xl border border-edge-subtle bg-surface-base p-5">
        <div className="grid gap-4 md:grid-cols-[minmax(0,1fr)_16rem]">
          <div><h3 className="text-sm font-semibold text-fg">{zh ? '运行模式' : 'Operating mode'}</h3><p className="mt-1 text-xs leading-5 text-fg-muted">{zh ? `当前生效：${modeLabels[data.config.mode]} · 写入级别：${data.config.writeDisposition}` : `Effective: ${modeLabels[data.config.mode]} · write disposition: ${data.config.writeDisposition}`}</p></div>
          <Select value={data.config.requestedMode} disabled={busy === 'mode'} onChange={(event) => void saveMode(event.target.value as DreamingMode)}>{Object.entries(modeLabels).map(([value, label]) => <SelectOption key={value} value={value}>{label}</SelectOption>)}</Select>
        </div>
        {data.config.requestedMode === 'automatic' && !data.readiness.ready ? <div className="mt-4 rounded-xl border border-warning/25 bg-warning-soft/35 px-4 py-3"><p className="text-sm font-medium text-fg">{zh ? '自动写入暂时降级为待确认' : 'Automatic writes are temporarily downgraded to review'}</p><p className="mt-1 text-xs leading-5 text-fg-muted">{data.readiness.reasons.map((reason) => readinessLabels[reason] ?? reason).join(zh ? '；' : '; ')}</p></div> : null}
        <div className="mt-5 grid gap-3 border-t border-edge-subtle pt-5 sm:grid-cols-3">{(['light', 'deep', 'rem'] as const).map((phase) => <div key={phase} className="rounded-xl border border-edge-subtle bg-surface-panel p-3"><div className="flex items-center justify-between gap-2"><div><p className="text-sm font-medium uppercase text-fg">{phase}</p><p className="mt-1 font-mono text-[11px] text-fg-subtle">{data.config.phases[phase].cron}</p></div><Button type="button" variant="ghost" className="h-8 px-2" disabled={!data.config.enabled || !data.config.phases[phase].enabled || busy !== null} onClick={() => void run(phase)}><Play className="size-3.5" aria-hidden />{zh ? '运行' : 'Run'}</Button></div></div>)}</div>
      </section>
      <section><h3 className="text-sm font-semibold text-fg">{zh ? '最近运行' : 'Recent runs'}</h3>{data.runs.length ? <div className="mt-3 divide-y divide-edge overflow-hidden rounded-xl border border-edge bg-surface-panel">{data.runs.map((run) => <div key={run.runId} className="flex flex-wrap items-center justify-between gap-3 px-4 py-3"><div><p className="text-sm font-medium uppercase text-fg">{run.phase} · {run.mode}</p><p className="mt-1 text-xs text-fg-muted">{run.reason ?? run.status}</p></div><div className="text-right text-xs text-fg-subtle"><p>{run.status}</p><p>{formatMediumDateTime(Date.parse(run.startedAt), language)}</p></div></div>)}</div> : <p className="mt-3 rounded-xl bg-surface-muted px-4 py-3 text-sm text-fg-muted">{zh ? '还没有运行记录。' : 'No runs yet.'}</p>}</section>
    </div>
  );
}
