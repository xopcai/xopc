import { useEffect, useState } from 'react';
import useSWR from 'swr';

import { fetchJson } from '@/lib/fetch';
import { apiUrl } from '@/lib/url';
import { useGatewayStore } from '@/stores/gateway-store';
import { useLocaleStore } from '@/stores/locale-store';
import { Skeleton } from '@/components/ui/skeleton';
import { TaskExpandableContent } from './task-expandable-content';

type Entry = {
  id: string; sequence: number; kind: string; body: string; authorKind: string;
  deliveryStatus?: string; createdAt: number;
};

export function TaskCollaborationPanel({ taskId }: { taskId: string }) {
  const token = useGatewayStore((state) => state.conversationId);
  const language = useLocaleStore((state) => state.language);
  const [draft, setDraft] = useState('');
  const [replyTo, setReplyTo] = useState<string | null>(null);
  const [sending, setSending] = useState(false);
  const [loadingOlder, setLoadingOlder] = useState(false);
  const [older, setOlder] = useState<Entry[]>([]);
  const [error, setError] = useState<string | null>(null);
  const path = apiUrl(`/api/tasks/${encodeURIComponent(taskId)}/collaboration`);
  const { data, error: loadError, mutate } = useSWR(['task-collaboration', taskId, token],
    () => fetchJson<{ ok: true; items: Entry[] }>(`${path}?recent=1`), { revalidateOnFocus: true });
  const entries = [...new Map([...older, ...(data?.items ?? [])].map((entry) => [entry.id, entry])).values()]
    .sort((a, b) => a.sequence - b.sequence);
  const loadOlder = async () => {
    const first = entries[0];
    if (!first || loadingOlder) return;
    setLoadingOlder(true);
    try {
      const result = await fetchJson<{ ok: true; items: Entry[] }>(`${path}?recent=1&beforeSequence=${first.sequence}`);
      setOlder((current) => [...result.items, ...current]);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : String(cause));
    } finally {
      setLoadingOlder(false);
    }
  };
  useEffect(() => {
    const refresh = (event: Event) => {
      const detail = (event as CustomEvent<{ taskId?: string }>).detail;
      if (!detail?.taskId || detail.taskId === taskId) void mutate();
    };
    window.addEventListener('task-collaboration-entry-added', refresh);
    window.addEventListener('gateway-realtime-connected', refresh);
    return () => {
      window.removeEventListener('task-collaboration-entry-added', refresh);
      window.removeEventListener('gateway-realtime-connected', refresh);
    };
  }, [mutate, taskId]);
  const submit = async () => {
    if (!draft.trim() || sending) return;
    setSending(true);
    setError(null);
    try {
      await fetchJson(path, { method: 'POST', headers: { 'idempotency-key': crypto.randomUUID() },
        body: JSON.stringify({ kind: replyTo ? 'answer' : 'instruction', body: draft.trim(),
          ...(replyTo ? { causationId: replyTo } : {}) }) });
      setDraft('');
      setReplyTo(null);
      await mutate();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : String(cause));
    } finally {
      setSending(false);
    }
  };
  return <section className="rounded-xl border border-edge bg-surface-panel p-4">
    <h2 className="text-sm font-semibold text-fg">{language === 'zh' ? '任务留言' : 'Task updates'}</h2>
    <div className="mt-3 max-h-64 space-y-2 overflow-y-auto">
      {!data && !loadError ? <div aria-busy="true" className="space-y-2">
        <Skeleton className="h-14 w-full" /><Skeleton className="h-14 w-4/5" />
      </div> : null}
      {loadError ? <p role="status" className="text-xs text-fg-muted">{language === 'zh' ? '暂时无法读取留言' : 'Updates unavailable'}</p> : null}
      {entries[0] && entries[0].sequence > 1 ? <button type="button" disabled={loadingOlder}
        onClick={() => void loadOlder()} className="text-xs text-accent hover:underline disabled:opacity-50">
        {language === 'zh' ? '查看更早留言' : 'Earlier updates'}
      </button> : null}
      {entries.map((entry) => <div key={entry.id} className="rounded-lg bg-surface-base px-3 py-2 text-sm">
        <div className="flex items-center gap-2 text-xs text-fg-subtle">
          <span>{entry.authorKind === 'worker_agent' ? (language === 'zh' ? '执行 Agent' : 'Worker')
            : entry.authorKind === 'main_agent' ? (language === 'zh' ? '主 Agent' : 'Main Agent')
              : entry.authorKind === 'system' ? (language === 'zh' ? '系统' : 'System') : (language === 'zh' ? '用户' : 'You')}</span>
          <span>· {entry.kind}</span>
          {entry.deliveryStatus ? <span>· {entry.deliveryStatus}</span> : null}
        </div>
        <div className="mt-1 min-w-0 text-fg" data-task-collaboration-body>
          <TaskExpandableContent content={entry.body} contentKey={`${taskId}:update:${entry.id}`} language={language} breaks previewHeight={120} />
        </div>
        {entry.kind === 'question' && entry.authorKind === 'worker_agent' ? <button type="button"
          className="mt-2 text-xs text-accent hover:underline" onClick={() => setReplyTo(entry.id)}>
          {language === 'zh' ? '回复问题' : 'Reply'}
        </button> : null}
      </div>)}
      {data && !entries.length ? <p className="text-xs text-fg-muted">{language === 'zh' ? '暂无进展留言' : 'No updates yet'}</p> : null}
    </div>
    {replyTo ? <p className="mt-3 text-xs text-accent">{language === 'zh' ? '正在回复执行 Agent 的问题' : 'Replying to the worker'}
      <button type="button" className="ml-2 underline" onClick={() => setReplyTo(null)}>{language === 'zh' ? '取消' : 'Cancel'}</button></p> : null}
    <textarea value={draft} onChange={(event) => setDraft(event.target.value)} rows={2}
      aria-label={language === 'zh' ? '任务留言' : 'Task message'}
      placeholder={language === 'zh' ? '给执行 Agent 留言' : 'Message the worker'}
      className="mt-3 w-full resize-y rounded-lg border border-edge bg-surface-base px-3 py-2 text-sm text-fg focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent" />
    {error ? <p role="alert" className="mt-1 text-xs text-danger">{error}</p> : null}
    <button type="button" disabled={!draft.trim() || sending} onClick={() => void submit()}
      className="mt-2 rounded-lg bg-accent px-3 py-2 text-xs font-medium text-white disabled:opacity-50">
      {sending ? (language === 'zh' ? '发送中' : 'Sending') : (language === 'zh' ? '发送' : 'Send')}
    </button>
  </section>;
}
