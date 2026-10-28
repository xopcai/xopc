import useSWRInfinite from 'swr/infinite';
import { useState } from 'react';

import { Skeleton } from '@/components/ui/skeleton';
import { cn } from '@/lib/cn';
import { messages } from '@/i18n/messages';
import { automationApi, type AutomationRun } from './automation-api';

export const isAutomationRunActive = (run: AutomationRun) => ['queued', 'running', 'cancelling'].includes(run.status);
type RunPage = Awaited<ReturnType<typeof automationApi.runs>>;

export function AutomationRunList({ automationId, projectId, language, selectedRunId, selectedRun, enabled = true, onSelectRun }: {
  automationId: string; projectId?: string; language: 'zh' | 'en'; selectedRunId?: string;
  selectedRun?: AutomationRun | null; enabled?: boolean;
  onSelectRun: (run: AutomationRun) => void;
}) {
  const [all, setAll] = useState(false);
  const zh = language === 'zh';
  const { data, error, size, setSize, isValidating, mutate } = useSWRInfinite<RunPage>(
    (index, previous: RunPage | null) => {
      if (!enabled || (index && !previous?.nextCursor)) return null;
      return ['automation-navigation-runs', automationId, projectId ?? '', index ? previous!.nextCursor : ''];
    },
    ([, id, scope, cursor]: string[]) => automationApi.runs(20, id, { projectId: scope || undefined, cursor: cursor || undefined }),
    { refreshInterval: pages => (pages?.length ?? 0) > 1 ? 0 : pages?.[0]?.runs.some(isAutomationRunActive) ? 3000 : 15000, refreshWhenHidden: false,
      refreshWhenOffline: false, revalidateAll: true, persistSize: true },
  );
  const runs = [...new Map((data ?? []).flatMap(page => page.runs).map(run => [run.id, run])).values()];
  const recent = all ? runs : runs.slice(0, 3);
  const visible = selectedRun?.automationId === automationId && !recent.some(run => run.id === selectedRun.id) ? [selectedRun, ...recent] : recent;
  const loadingMore = isValidating && (!data || data.length < size);
  const buttonClass = 'w-full rounded-lg px-3 py-2 text-left text-xs text-fg-muted hover:bg-surface-hover focus-visible:ring-2 focus-visible:ring-accent';
  return <div className="space-y-1 pb-3 pl-8 pr-2" aria-label={zh ? '执行记录' : 'Execution history'}>
    {!data && !error ? <div aria-busy="true" className="space-y-2 px-3 py-2"><Skeleton className="h-8" /><Skeleton className="h-8" /></div> : null}
    {visible.map(run => <button key={run.id} type="button" className={cn(buttonClass, selectedRunId === run.id && 'bg-surface-active text-fg')}
      aria-current={selectedRunId === run.id ? 'true' : undefined} onClick={() => onSelectRun(run)}>
      <span className="flex items-center justify-between gap-2"><span>{new Date(run.createdAtMs).toLocaleString(zh ? 'zh-CN' : 'en-US', { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' })}</span>
        {!isAutomationRunActive(run) && run.readAtMs == null ? <span className="size-1.5 shrink-0 rounded-full bg-accent"><span className="sr-only">{zh ? '未读' : 'Unread'}</span></span> : null}</span>
      {selectedRun?.id === run.id && !recent.some(item => item.id === run.id) ? <span className="block text-accent-fg">{zh ? '当前查看' : 'Currently viewing'}</span> : null}
      <span className={cn('block', ['failed', 'timeout'].includes(run.status) && 'text-danger')}>{messages(language).automations.status[run.status]}</span>
    </button>)}
    {data && runs.length === 0 ? <p className="px-3 py-2 text-xs text-fg-muted">{zh ? '尚未执行' : 'No executions yet'}</p> : null}
    {error ? <div role="alert" className="px-3 py-2 text-xs text-danger"><p>{zh ? '执行记录加载失败' : 'Could not load history'}</p><button type="button" className={buttonClass} onClick={() => void mutate()}>{zh ? '重试' : 'Retry'}</button></div> : null}
    {!all && (runs.length > 3 || data?.[0]?.hasMore) ? <button type="button" className={buttonClass} onClick={() => setAll(true)}>{zh ? '查看全部执行' : 'View all executions'}</button> : null}
    {all && data?.at(-1)?.hasMore ? <button type="button" className={buttonClass} disabled={loadingMore} onClick={() => void setSize(size + 1)}>{loadingMore ? (zh ? '加载中…' : 'Loading…') : (zh ? '加载更多' : 'Load more')}</button> : null}
    {all ? <button type="button" className={buttonClass} onClick={() => setAll(false)}>{zh ? '收起历史' : 'Show recent'}</button> : null}
  </div>;
}
