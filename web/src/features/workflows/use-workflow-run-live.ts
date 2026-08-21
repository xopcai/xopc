import { useEffect } from 'react';
import useSWR from 'swr';

import { useGatewayStore } from '@/stores/gateway-store';

import { getWorkflowRun, type WorkflowRunView } from './workflow-api';
import { ACTIVE_RUN_STATUSES } from './workflow-page.constants';

/** Live workflow run view for a dedicated workflow chat session (realtime + polling fallback). */
export function useWorkflowRunLive(runId: string | null | undefined, options?: { ownerAgentId?: string }) {
  const token = useGatewayStore((s) => s.token);
  const hasToken = Boolean(token);
  const trimmedRunId = runId?.trim() || null;
  const ownerAgentId = options?.ownerAgentId?.trim() || undefined;

  const swr = useSWR(
    hasToken && trimmedRunId ? ['workflow-run-live', trimmedRunId, ownerAgentId ?? '', token] : null,
    () => getWorkflowRun(trimmedRunId!, { ownerAgentId }),
    {
      revalidateOnFocus: false,
      refreshInterval: (latest) => {
        if (!latest) return 0;
        return ACTIVE_RUN_STATUSES.has(latest.run.status) ? 3000 : 0;
      },
    },
  );

  useEffect(() => {
    if (!trimmedRunId) return;
    const handler = (event: Event) => {
      const detail = (event as CustomEvent<{ runId?: string; view?: WorkflowRunView }>).detail;
      if (detail?.runId !== trimmedRunId) return;
      const eventAgentId = detail.view?.run.metadata?.agentId;
      if (ownerAgentId && eventAgentId && eventAgentId !== ownerAgentId) return;
      if (detail.view) {
        void swr.mutate(detail.view, { revalidate: false });
        return;
      }
      void swr.mutate();
    };
    window.addEventListener('workflow-run-updated', handler);
    return () => window.removeEventListener('workflow-run-updated', handler);
  }, [ownerAgentId, swr.mutate, trimmedRunId]);

  return {
    view: swr.data,
    loading: swr.isLoading,
    error: swr.error,
    mutate: swr.mutate,
  };
}
