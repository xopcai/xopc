import { lazy, Suspense, useEffect, useMemo, useRef } from 'react';
import useSWR, { useSWRConfig } from 'swr';

import { Button } from '@/components/ui/button';
import { MarkdownView } from '@/components/markdown/markdown-view';
import { Skeleton } from '@/components/ui/skeleton';
import { useChatSessionStore } from '@/features/chat/session/chat-session-store';
import { messages } from '@/i18n/messages';
import { automationApi, type Automation, type AutomationRun } from './automation-api';
import { AutomationDeliveryStatus } from './automation-delivery-status';
import { AutomationContinueButton } from './automation-task-card';
import { automationRunFailureSummary } from './automation-result-state';

const ChatPage = lazy(() => import('@/features/chat/chat-page').then(module => ({ default: module.ChatPage })));

export function AutomationConversation({ automation, conversationId, runs, language, onSelectRun, onConfigured }: {
  automation?: Automation; conversationId?: string; runs: AutomationRun[]; language: 'zh' | 'en';
  onSelectRun: (id: string) => void; onConfigured?: (id: string) => void;
}) {
  const automationId = automation?.id;
  const { data, error, mutate } = useSWR(automationId && !conversationId ? ['automation-workspace-chat', automationId] : null,
    () => automationApi.openConfiguration({ automationId }),
    { revalidateOnFocus: false, revalidateOnReconnect: false, shouldRetryOnError: false });
  const { data: setup } = useSWR(conversationId ? ['automation-configuration', conversationId] : null,
    () => automationApi.configuration(conversationId!), { refreshInterval: 3000 });
  useEffect(() => { if (!automation && setup?.automation) onConfigured?.(setup.automation.id); }, [automation, setup, onConfigured]);
  const id = conversationId ?? data?.conversationId;
  const { mutate: revalidate } = useSWRConfig();
  const working = useChatSessionStore(state => Boolean(id && (state.sessions[id]?.streaming || state.sessions[id]?.sending)));
  const wasWorking = useRef(false);
  useEffect(() => {
    if (wasWorking.current && !working) {
      void revalidate(key => Array.isArray(key) && ['automations', 'automation-runs', 'automation-history', 'automation-configuration'].includes(String(key[0])));
    }
    wasWorking.current = working;
  }, [working, revalidate]);
  const zh = language === 'zh';
  const m = messages(language);
  const entries = useMemo(() => runs.map(run => ({
    id: `automation-run:${run.id}`,
    timestamp: run.createdAtMs,
    content: <article className="mx-auto w-full max-w-[var(--max-width-chat-frame)] space-y-3 py-3" aria-label={zh ? '任务运行结果' : 'Task run result'}>
      <div className="flex items-center justify-between gap-3 text-xs text-fg-muted">
        <span>{new Date(run.createdAtMs).toLocaleString(zh ? 'zh-CN' : 'en-US', { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' })} · {m.automations.status[run.status]}</span>
        <button type="button" className="rounded-md px-2 py-1.5 hover:bg-surface-hover focus-visible:ring-2 focus-visible:ring-accent" onClick={() => onSelectRun(run.id)}>{zh ? '查看详情' : 'View details'}</button>
      </div>
      {run.error ? <p className="whitespace-pre-wrap text-sm leading-6 text-danger">{automationRunFailureSummary(run, language)}</p> : run.summary ? <MarkdownView content={run.summary} /> : <p className="text-sm text-fg-muted">{zh ? '正在执行，结果会显示在这里。' : 'Running. The result will appear here.'}</p>}
      {run.status === 'failed' || run.status === 'timeout' ? <AutomationContinueButton automationId={run.automationId} runId={run.id} language={language} variant="secondary" /> : null}
      {!['queued', 'running', 'cancelling'].includes(run.status) ? <AutomationDeliveryStatus runId={run.id} language={language} /> : null}
    </article>,
  })), [runs, language, zh, m.automations.status, onSelectRun]);
  if (error) return <div role="alert" className="p-6 text-sm text-fg-muted"><p>{zh ? '暂时无法打开任务对话。' : 'Could not open the task conversation.'}</p><Button variant="secondary" onClick={() => void mutate()}>{zh ? '重试' : 'Retry'}</Button></div>;
  return <section className="flex h-full min-h-0 min-w-0 flex-col overflow-hidden" aria-label={zh ? '任务对话' : 'Task conversation'}>
    {id ? <Suspense fallback={<Skeleton className="m-5 h-40" />}><ChatPage key={id} embedded conversationId={id} automationWorkspace automationTimelineEntries={entries} /></Suspense> : <div className="space-y-4 p-6"><Skeleton className="h-20 w-2/3" /><Skeleton className="h-28" /></div>}
  </section>;
}
