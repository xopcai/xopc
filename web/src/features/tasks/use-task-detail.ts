import { TaskChangedEventSchema, type TaskChangedEvent } from '@xopcai/gateway-contract';
import { useEffect, useRef, useState } from 'react';
import useSWR from 'swr';

import { ensureTaskConversation, fetchTask } from '@/features/tasks/home-api';
import { useGatewayStore } from '@/stores/gateway-store';

export function taskDetailSWRKey(taskId: string, token: string | undefined): readonly [string, string, string] | null {
  return taskId ? ['task-detail', taskId, token ?? ''] : null;
}

export function useTaskDetail(taskId: string) {
  const token = useGatewayStore((state) => state.token);
  const [lastChange, setLastChange] = useState<TaskChangedEvent | null>(null);
  const [conversationLoading, setConversationLoading] = useState(false);
  const [conversationError, setConversationError] = useState<unknown>(null);
  const ensureMarkerRef = useRef('');
  const swr = useSWR(
    taskDetailSWRKey(taskId, token),
    () => fetchTask(taskId),
    {
      keepPreviousData: false,
      revalidateOnFocus: true,
      revalidateOnReconnect: true,
      refreshInterval: (latest) => latest && [
        'queued', 'running', 'waiting', 'verifying',
      ].includes(latest.operationalState)
        ? 5_000
        : 0,
    },
  );

  useEffect(() => {
    setLastChange(null);
    setConversationLoading(false);
    setConversationError(null);
    ensureMarkerRef.current = '';
  }, [taskId]);

  useEffect(() => {
    const detail = swr.data;
    if (!detail || detail.conversation.activeSessionKey) return;
    const marker = `${taskId}:${detail.task.version}`;
    if (ensureMarkerRef.current === marker) return;
    ensureMarkerRef.current = marker;
    setConversationLoading(true);
    setConversationError(null);
    void ensureTaskConversation(taskId)
      .then(() => ensureMarkerRef.current === marker ? swr.mutate() : undefined)
      .catch((error: unknown) => {
        if (ensureMarkerRef.current === marker) setConversationError(error);
      })
      .finally(() => {
        if (ensureMarkerRef.current === marker) setConversationLoading(false);
      });
  }, [swr.data, swr.mutate, taskId]);

  useEffect(() => {
    let refreshTimer: number | undefined;
    const refresh = () => {
      window.clearTimeout(refreshTimer);
      refreshTimer = window.setTimeout(() => void swr.mutate(), 120);
    };
    const onTaskChanged = (event: Event) => {
      const parsed = TaskChangedEventSchema.safeParse((event as CustomEvent<unknown>).detail);
      if (!parsed.success || parsed.data.taskId !== taskId) return;
      setLastChange(parsed.data);
      refresh();
    };
    const onRealtimeRecovery = () => refresh();
    window.addEventListener('task-changed-v2', onTaskChanged);
    window.addEventListener('gateway-realtime-connected', onRealtimeRecovery);
    window.addEventListener('realtime-gap', onRealtimeRecovery);
    return () => {
      window.clearTimeout(refreshTimer);
      window.removeEventListener('task-changed-v2', onTaskChanged);
      window.removeEventListener('gateway-realtime-connected', onRealtimeRecovery);
      window.removeEventListener('realtime-gap', onRealtimeRecovery);
    };
  }, [swr.mutate, taskId]);

  return { ...swr, lastChange, conversationLoading, conversationError };
}
