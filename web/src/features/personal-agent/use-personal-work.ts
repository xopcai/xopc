import { useCallback, useEffect, useRef, useState } from 'react';
import useSWR from 'swr';
import useSWRInfinite from 'swr/infinite';
import type { TaskOperationalState, TaskPresentation, TaskResolution, TurnOutcomeDeliverable } from '@xopcai/gateway-contract';

import { useChatRunPresenceStore } from '@/features/chat/session/chat-run-presence-store';
import { taskCopy } from '@/features/tasks/task-copy';
import { fetchJson } from '@/lib/fetch';
import { apiUrl } from '@/lib/url';
import { useGatewayStore } from '@/stores/gateway-store';
import type { PersonalAvatarActivity } from './personal-avatar';

export type PersonalWorkItem = {
  id: string;
  title: string;
  phase: string;
  operationalState?: TaskOperationalState;
  presentation: TaskPresentation;
  resolution?: TaskResolution | null;
  updatedAt: number;
  attention?: { kind: string; summary: string };
  prompt?: { id: string; conversationId: string };
  artifact?: TurnOutcomeDeliverable;
};

type PersonalWork = { current: PersonalWorkItem[]; items: PersonalWorkItem[]; total: number };
type PersonalPrompt = { id: string; question: string; kind: 'approval' | 'input'; status: string; expiresAt?: number };

const RECENT_WORK_PAGE_SIZE = 10;

function personalWorkPath(offset: number) {
  return apiUrl(`/api/personal-agent/activity?view=work&limit=${RECENT_WORK_PAGE_SIZE}&offset=${offset}`);
}

async function fetchPersonalWork([url]: readonly [string, string, string | undefined]) {
  return (await fetchJson<{ payload: PersonalWork }>(url)).payload;
}

function usePersonalWork(conversationId: string | undefined) {
  const identity = useGatewayStore(state => state.conversationId);
  return useSWR(conversationId ? [personalWorkPath(0), conversationId, identity] as const : null, fetchPersonalWork);
}

export function usePersonalWorkHistory(scope: string, firstPage: PersonalWork | undefined, enabled: boolean) {
  const identity = useGatewayStore(state => state.conversationId);
  const [started, setStarted] = useState(false);
  const total = firstPage?.total ?? 0;
  const { data, error, isValidating, size, setSize, mutate } = useSWRInfinite(
    (index: number, previous: PersonalWork | null) => {
      const offset = (index + 1) * RECENT_WORK_PAGE_SIZE;
      if (!started || offset >= total || (previous && previous.items.length < RECENT_WORK_PAGE_SIZE)) return null;
      return [personalWorkPath(offset), scope, identity] as const;
    },
    fetchPersonalWork,
    { revalidateFirstPage: false, shouldRetryOnError: false },
  );
  const firstPageRevision = JSON.stringify([total, firstPage?.items.map(item => item.id)]);
  const previousRevision = useRef(firstPageRevision);
  useEffect(() => {
    const changed = previousRevision.current !== firstPageRevision;
    previousRevision.current = firstPageRevision;
    // Offset pages can move when tasks are added to or removed from the first page.
    if (changed && started) void mutate();
  }, [firstPageRevision, mutate, started]);
  const loadedPages = data?.length ?? 0;
  const hasMore = (loadedPages + 1) * RECENT_WORK_PAGE_SIZE < total
    && (loadedPages === 0 || data?.at(-1)?.items.length === RECENT_WORK_PAGE_SIZE);
  const loading = started && !error && hasMore && (isValidating || size > loadedPages);
  const loadMore = useCallback(() => {
    if (started) void setSize(size + 1);
    else setStarted(true);
  }, [setSize, size, started]);
  return {
    items: [...(firstPage?.items ?? []), ...(data ?? []).flatMap(page => page.items)],
    error: enabled ? error : undefined,
    hasMore: enabled && hasMore,
    loading: enabled && loading,
    loadMore,
    retry: () => void mutate(),
  };
}

export function usePersonalPrompt(conversationId: string | undefined) {
  const identity = useGatewayStore(state => state.conversationId);
  const path = apiUrl(`/api/sessions/${encodeURIComponent(conversationId ?? '')}/clarification`);
  return useSWR(conversationId ? [path, conversationId, identity] as const : null,
    async ([url]) => (await fetchJson<{ payload?: { clarification?: PersonalPrompt } }>(url)).payload?.clarification ?? null);
}

export function needsPersonalWorkAttention(item: PersonalWorkItem): boolean {
  return Boolean(item.attention) || item.presentation.status === 'needsUser' || item.presentation.status === 'review';
}

export function useRefreshPersonalWork(conversationId: string | undefined, refreshWork: () => Promise<unknown>, refreshPrompt?: () => Promise<unknown>) {
  useEffect(() => {
    if (!conversationId) return;
    let timer: number | undefined;
    const refresh = () => {
      window.clearTimeout(timer);
      timer = window.setTimeout(() => {
        void Promise.allSettled([refreshWork(), refreshPrompt?.()]);
      }, 120);
    };
    const events = ['task-changed-v2', 'task-updated', 'clarification-updated', 'gateway-realtime-connected'];
    const onTranscriptUpdated = (event: Event) => {
      if ((event as CustomEvent<{ key?: string }>).detail?.key === conversationId) refresh();
    };
    events.forEach(event => window.addEventListener(event, refresh));
    window.addEventListener('session-transcript-updated', onTranscriptUpdated);
    const interval = window.setInterval(() => {
      if (document.visibilityState === 'visible') refresh();
    }, 15_000);
    return () => {
      window.clearTimeout(timer);
      window.clearInterval(interval);
      events.forEach(event => window.removeEventListener(event, refresh));
      window.removeEventListener('session-transcript-updated', onTranscriptUpdated);
    };
  }, [conversationId, refreshWork, refreshPrompt]);
}

export function usePersonalListPagination(enabled: boolean, loadMore: () => void) {
  const listRef = useRef<HTMLDivElement>(null);
  const loadMoreRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const root = listRef.current;
    const sentinel = loadMoreRef.current;
    if (!enabled || !root || !sentinel || typeof IntersectionObserver === 'undefined') return;
    const observer = new IntersectionObserver(entries => {
      if (entries.some(entry => entry.isIntersecting)) loadMore();
    }, { root, rootMargin: '0px 0px 120px' });
    observer.observe(sentinel);
    return () => observer.disconnect();
  }, [enabled, loadMore]);
  return { listRef, loadMoreRef };
}

export function isOpenPersonalPrompt(prompt: PersonalPrompt | null | undefined): prompt is PersonalPrompt {
  return prompt?.status === 'open' && (prompt.expiresAt === undefined || prompt.expiresAt > Date.now());
}

export function personalWorkStatus(item: PersonalWorkItem, zh: boolean): [string, string] {
  const { status } = item.presentation;
  const tone = status === 'failed' ? 'bg-danger'
    : ['needsUser', 'review', 'waiting', 'blocked', 'paused'].includes(status) ? 'bg-warning'
      : ['running', 'verifying', 'completed'].includes(status) ? 'bg-accent' : 'bg-fg-subtle';
  return [taskCopy(zh ? 'zh' : 'en').detailStatuses[status], tone];
}

export function usePersonalWorkOverview(conversationId: string | undefined, zh: boolean) {
  const run = useChatRunPresenceStore(state => conversationId ? state.runs[conversationId] : undefined);
  const { data: work, mutate: refreshWork, error: workError } = usePersonalWork(conversationId);
  const { data: prompt, mutate: refreshPrompt, error: promptError } = usePersonalPrompt(conversationId);
  const current = work?.current ?? [];
  const pending = current.filter(needsPersonalWorkAttention);
  const attentionCount = pending.length + Number(isOpenPersonalPrompt(prompt) && !pending.some(item => item.prompt?.id === prompt.id));
  const running = current.filter(item => item.operationalState === 'running' || item.operationalState === 'verifying');
  const queued = current.filter(item => item.operationalState === 'queued' || item.operationalState === 'allocating');
  const recentDeliveryAt = work?.items.find(item => item.resolution === 'done')?.updatedAt;
  const [deliveredAt, setDeliveredAt] = useState<number>();
  useEffect(() => {
    if (recentDeliveryAt === undefined) return;
    const remaining = recentDeliveryAt + 4_000 - Date.now();
    if (remaining <= 0) return;
    setDeliveredAt(recentDeliveryAt);
    const timer = window.setTimeout(() => setDeliveredAt(undefined), remaining);
    return () => window.clearTimeout(timer);
  }, [recentDeliveryAt]);
  const delivered = deliveredAt !== undefined && deliveredAt === recentDeliveryAt;
  const avatarState: PersonalAvatarActivity = attentionCount ? 'waiting' : running.length || queued.length || run?.status === 'running'
    ? 'working' : run?.status === 'waiting' ? 'waiting' : delivered ? 'delivered' : 'idle';
  let summary = '';
  if (attentionCount) summary = zh ? `有 ${attentionCount} 项待你处理` : `${attentionCount} to review`;
  else if (running.length > 1) summary = zh ? `有 ${running.length} 项正在推进` : `${running.length} in progress`;
  else if (running[0]) summary = zh ? `正在推进 · ${running[0].title}` : `Working · ${running[0].title}`;
  else if (run?.status === 'running') summary = zh ? '正在回复' : 'Responding';
  else if (queued.length) summary = zh ? `有 ${queued.length} 项等待开始` : `${queued.length} queued`;
  else if (run?.status === 'waiting') summary = zh ? '等待继续' : 'Waiting to resume';
  else if (delivered) summary = zh ? '刚刚完成交付' : 'Just delivered';
  else if (workError || promptError) summary = zh ? '暂时无法更新状态' : 'Status unavailable';
  return { work, workError, prompt, avatarState, summary, attentionCount, refreshWork, refreshPrompt };
}
