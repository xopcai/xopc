import { TaskChangedEventSchema, type TaskChangedEvent } from '@xopcai/gateway-contract';
import { useEffect, useState } from 'react';
import useSWR from 'swr';

import { fetchTask } from '@/features/tasks/home-api';
import { useGatewayStore } from '@/stores/gateway-store';

export function taskDetailSWRKey(taskId: string, token: string | undefined): readonly [string, string, string] | null {
  return taskId ? ['task-detail', taskId, token ?? ''] : null;
}

export function useTaskDetail(taskId: string) {
  const token = useGatewayStore((state) => state.token);
  const [lastChange, setLastChange] = useState<TaskChangedEvent | null>(null);
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

  useEffect(() => setLastChange(null), [taskId]);

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

  return { ...swr, lastChange };
}
