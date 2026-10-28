import { lazy, Suspense, useCallback, useEffect, useRef, useState } from 'react';
import useSWR, { useSWRConfig } from 'swr';
import { ArrowLeft } from 'lucide-react';

import { Button } from '@/components/ui/button';
import { Skeleton } from '@/components/ui/skeleton';
import { MarkdownView } from '@/components/markdown/markdown-view';
import { useChatSessionStore } from '@/features/chat/session/chat-session-store';
import { getSessionDetail } from '@/features/sessions/session-api';
import { messages } from '@/i18n/messages';
import { automationApi, type AutomationRun } from './automation-api';
import { AutomationDeliveryStatus } from './automation-delivery-status';
import { isAutomationRunActive } from './automation-run-list';

const ChatPage = lazy(() => import('@/features/chat/chat-page').then(module => ({ default: module.ChatPage })));

export function AutomationExecutionPanel({ runId, automationId, projectId, language, onConfigure, onDetails, onBack }: {
  runId: string; automationId: string; projectId?: string; language: 'zh' | 'en';
  onConfigure: (run: AutomationRun) => void; onDetails: (id: string) => void; onBack: () => void;
}) {
  const zh = language === 'zh';
  const [openShared, setOpenShared] = useState(false);
  const [historyReady, setHistoryReady] = useState(false);
  const [located, setLocated] = useState<boolean | null>(null);
  const onInitialTurnLocated = useCallback((found: boolean) => setLocated(found), []);
  const onHistoryReady = useCallback(() => setHistoryReady(true), []);
  const { mutate: revalidate } = useSWRConfig();
  const readPending = useRef(false);
  const { data, error, mutate } = useSWR(['automation-execution', automationId, runId, projectId ?? ''], async () => {
    const { run } = await automationApi.getRun(runId);
    if (run.automationId !== automationId) throw new Error(zh ? '执行记录不属于此自动化' : 'Execution does not belong to this automation');
    const { automation } = await automationApi.get(automationId);
    if (projectId && automation.projectId !== projectId) throw new Error(zh ? '执行记录不属于此项目' : 'Execution does not belong to this project');
    return { run, automation };
  }, { refreshInterval: value => value && isAutomationRunActive(value.run) ? 3000 : 15000, shouldRetryOnError: false });
  const run = data?.run;
  const conversationId = run?.conversationId;
  const conversationWorking = useChatSessionStore(state => Boolean(conversationId && (state.sessions[conversationId]?.streaming || state.sessions[conversationId]?.sending)));
  const { data: detail, error: sessionError, mutate: reloadSession } = useSWR(conversationId ? ['automation-execution-session', conversationId] : null,
    () => getSessionDetail(conversationId!), { shouldRetryOnError: false });
  // A mode change must not make an older shared conversation appear isolated.
  const shared = run?.conversationShared || data?.automation.conversationMode === 'continuous'
    || (detail?.customData?.latestAutomationRunId !== undefined && detail.customData.latestAutomationRunId !== runId);
  const showChat = Boolean(detail && (!shared || openShared));
  const contentReady = !error && Boolean(run && (!conversationId || (shared && !openShared && detail && !sessionError && Boolean(run?.summary || run?.error)) || (detail && !sessionError && historyReady)));
  useEffect(() => {
    if (!run || !contentReady || isAutomationRunActive(run) || run.readAtMs != null || readPending.current) return;
    readPending.current = true;
    void automationApi.markRunRead(run.id).then(async () => {
      await Promise.all([
        mutate(),
        revalidate(key => (Array.isArray(key) && ['automations', 'automation-runs', 'automation-history', 'automation-navigation-runs'].includes(String(key[0])))
          || key === 'automations-global-system-source'),
      ]);
    }).catch(() => { /* Keep unread when acknowledgement fails; retry on the next successful refresh. */ }).finally(() => { readPending.current = false; });
  }, [run, contentReady, mutate, revalidate]);
  if (error) return <section role="alert" className="space-y-3 p-5"><p>{error instanceof Error ? error.message : zh ? '执行记录加载失败' : 'Could not load execution'}</p><Button onClick={() => void mutate()}>{zh ? '重试' : 'Retry'}</Button><Button onClick={onBack}>{zh ? '返回自动化' : 'Back to automation'}</Button></section>;
  if (!run) return <div className="space-y-4 p-5" aria-busy="true"><Skeleton className="h-6 w-2/3" /><Skeleton className="h-20" /></div>;
  const active = isAutomationRunActive(run);
  return <section className="flex h-full min-h-0 min-w-0 flex-col overflow-hidden" aria-label={zh ? '执行会话' : 'Execution conversation'}>
    <header className="shrink-0 space-y-2 border-b border-edge px-4 py-3">
      <div className="flex min-w-0 items-center gap-2"><Button variant="ghost" className="shrink-0" onClick={onBack} aria-label={zh ? '返回自动化' : 'Back to automation'}><ArrowLeft className="size-4" /></Button><h2 className="truncate text-sm font-medium text-fg">{run.automationName}</h2></div>
      <div className="flex flex-wrap items-center gap-3 text-xs text-fg-muted"><span>{new Date(run.createdAtMs).toLocaleString(zh ? 'zh-CN' : 'en-US')} · {messages(language).automations.status[run.status]}</span>
        <button type="button" className="rounded px-2 py-1.5 text-accent-fg hover:bg-surface-hover focus-visible:ring-2 focus-visible:ring-accent" onClick={() => onDetails(run.id)}>{zh ? '运行详情' : 'Run details'}</button>
        <button type="button" className="rounded px-2 py-1.5 text-accent-fg hover:bg-surface-hover focus-visible:ring-2 focus-visible:ring-accent" onClick={() => onConfigure(run)}>{zh ? '调整自动化' : 'Adjust automation'}</button></div>
      {shared ? <p className="text-xs text-fg-muted">{zh ? '多次执行可能共用此会话；下方摘要对应所选执行。' : 'Executions may share this conversation. The summary belongs to the selected execution.'}{data?.automation.conversationMode === 'continuous' ? (zh ? '追问会进入后续运行上下文。' : ' Follow-ups become context for future runs.') : null}</p> : null}
      {openShared ? <p role="status" className="text-xs text-fg-muted">{located === true ? (zh ? '已定位到所选执行的会话起点。' : 'Located the selected execution in this conversation.') : located === false ? (zh ? '旧记录缺少可用的执行定位信息，当前显示完整会话。' : 'No matching turn was found in the available history. Showing the full conversation.') : (zh ? '正在定位所选执行…' : 'Locating the selected execution…')}</p> : null}
      {active ? <p role="status" className="text-xs text-fg-muted">{zh ? '执行中，完成后可继续追问。' : 'Execution in progress. Follow up after it finishes.'}</p> : null}
    </header>
    {showChat ? <Suspense fallback={<Skeleton className="m-5 h-40" />}><ChatPage key={conversationId} embedded automationExecution conversationId={conversationId} readOnly={active || conversationWorking} onHistoryReady={onHistoryReady} initialTurnId={shared ? run.id : undefined} onInitialTurnLocated={onInitialTurnLocated} /></Suspense>
      : <div className="min-h-0 flex-1 space-y-4 overflow-y-auto p-5">
        {run.summary ? <MarkdownView content={run.summary} /> : null}
        {run.error ? <p className="whitespace-pre-wrap text-sm text-danger">{run.error}</p> : null}
        {!conversationId ? <p className="text-sm text-fg-muted">{active ? (zh ? '等待执行会话，开始后会自动更新。' : 'Waiting for the execution conversation. This view updates automatically.') : (zh ? '本次执行没有关联会话，可查看运行结果和详情。' : 'No conversation is associated with this execution. Results and diagnostics remain available.')}</p> : null}
        {conversationId && !detail && !sessionError ? <Skeleton className="h-24" /> : null}
        {sessionError ? <div role="alert" className="space-y-2 text-sm text-fg-muted"><p>{(sessionError as { status?: number }).status === 404 ? (zh ? '执行会话已删除，运行结果仍保留。' : 'The execution conversation was deleted. Results are still available.') : (zh ? '执行会话暂时无法读取，运行结果仍保留。' : 'The conversation is unavailable. Results are still available.')}</p><Button onClick={() => void reloadSession()}>{zh ? '重试' : 'Retry'}</Button></div> : null}
        {shared && detail ? <Button variant="secondary" onClick={() => setOpenShared(true)}>{zh ? '打开共享会话' : 'Open shared conversation'}</Button> : null}
        {!active ? <AutomationDeliveryStatus runId={run.id} language={language} /> : null}
      </div>}
  </section>;
}
