import { useEffect } from 'react';
import useSWR from 'swr';

import { useGatewayStore } from '@/stores/gateway-store';

import { getWorkflowRun, type WorkflowRunView } from './workflow-api';
import { ACTIVE_RUN_STATUSES } from './workflow-page.constants';

/** Live workflow run view for a dedicated workflow chat session (SSE + polling fallback). */
export function useWorkflowRunLive(runId: string | null | undefined) {
  const token = useGatewayStore((s) => s.token);
  const hasToken = Boolean(token);
  const trimmedRunId = runId?.trim() || null;

  const swr = useSWR(
    hasToken && trimmedRunId ? ['workflow-run-live', trimmedRunId, token] : null,
    () => getWorkflowRun(trimmedRunId!),
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
      if (detail.view) {
        void swr.mutate(detail.view, { revalidate: false });
        return;
      }
      void swr.mutate();
    };
    window.addEventListener('workflow-run-updated', handler);
    return () => window.removeEventListener('workflow-run-updated', handler);
  }, [swr.mutate, trimmedRunId]);

  return {
    view: swr.data,
    loading: swr.isLoading,
    error: swr.error,
    mutate: swr.mutate,
  };
}
