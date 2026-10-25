import useSWR from 'swr';

import { Button } from '@/components/ui/button';
import { Skeleton } from '@/components/ui/skeleton';
import { MarkdownView } from '@/components/markdown/markdown-view';
import { automationApi } from '@/features/automations/automation-api';
import { AutomationDeliveryStatus } from '@/features/automations/automation-delivery-status';
import { automationRunFailureSummary } from '@/features/automations/automation-result-state';
import { AutomationContinueButton } from '@/features/automations/automation-task-card';
import { messages } from '@/i18n/messages';
import { useLocaleStore } from '@/stores/locale-store';

const active = new Set(['queued', 'running', 'cancelling']);

export function AutomationRunPreview({ automationId, runId }: { automationId: string; runId?: string }) {
  const language = useLocaleStore(state => state.language);
  const zh = language === 'zh';
  const { data, error, mutate } = useSWR(['automation-run-preview', automationId, runId], async () => {
    const [task, result] = await Promise.all([
      automationApi.get(automationId),
      runId ? automationApi.getRun(runId).then(value => value.run) : Promise.resolve(undefined),
    ]);
    if (result && result.automationId !== automationId) throw new Error('Run does not belong to this task');
    return { task: task.automation, run: result };
  }, { shouldRetryOnError: false, refreshInterval: value => value && (value.task.state.runningRunId || (value.run && active.has(value.run.status))) ? 3000 : 0 });
  if (error) return <div role="alert" className="space-y-3 text-sm text-fg-muted"><p>{zh ? '暂时无法读取这次运行，请重试。' : 'Could not load this run. Try again.'}</p><Button variant="secondary" onClick={() => void mutate()}>{zh ? '重试' : 'Retry'}</Button></div>;
  if (!data) return <div className="space-y-4" aria-busy="true"><Skeleton className="h-6 w-2/3" /><Skeleton className="h-4 w-1/3" /><Skeleton className="h-32" /></div>;
  const run = data.run;
  if (!run) return <div className="space-y-3"><h2 className="text-lg font-medium text-fg">{data.task.name}</h2><p className="text-sm text-fg-muted">{zh ? '这条旧链接没有关联具体执行，请从任务的运行记录查看。' : 'This older link does not identify an execution. Choose one from the task history.'}</p></div>;
  return <div className="space-y-5">
    <div className="space-y-2"><h2 className="text-lg font-medium text-fg">{data.task.name}</h2><p role="status" className="text-sm text-fg-muted">{messages(language).automations.status[run.status]} · {new Date(run.createdAtMs).toLocaleString(zh ? 'zh-CN' : 'en-US')}</p></div>
    {run.status === 'queued' ? <p className="text-sm text-fg-muted">{zh ? '任务正在排队，开始后会自动更新。' : 'Queued. This view updates when execution starts.'}</p> : run.status === 'running' ? <p className="text-sm text-fg-muted">{zh ? '正在执行，结果会自动显示在这里。' : 'Running. The result will appear here automatically.'}</p> : null}
    {run.summary ? <MarkdownView content={run.summary} /> : null}
    {run.error ? <p className="text-sm leading-6 text-danger">{automationRunFailureSummary(run, language)}</p> : null}
    {run.status === 'failed' || run.status === 'timeout' ? <AutomationContinueButton automationId={automationId} runId={run.id} language={language} variant="secondary" /> : null}
    {!active.has(run.status) ? <AutomationDeliveryStatus runId={run.id} language={language} /> : null}
  </div>;
}
