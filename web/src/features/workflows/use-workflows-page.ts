import { useCallback, useEffect, useMemo, useState } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import useSWR from 'swr';

import { messages } from '@/i18n/messages';
import { useGatewayStore } from '@/stores/gateway-store';
import { useLocaleStore } from '@/stores/locale-store';

import {
  cancelWorkflowRun,
  deleteWorkflowDefinition,
  getWorkflowRun,
  getWorkflowStats,
  listWorkflowDefinitions,
  listWorkflowRuns,
  retryWorkflowRun,
  saveWorkflowDefinition,
  startWorkflowRun,
  type WorkflowDefinition,
  type WorkflowRunSummary,
} from './workflow-api';
import {
  RUN_FETCH_LIMIT,
  WORKFLOW_DEF_PARAM,
  WORKFLOW_RUN_PARAM,
  WORKFLOW_SEARCH_PARAM,
  WORKFLOW_START_PARAM,
  WORKFLOW_TAB_PARAM,
  WORKFLOW_WF_FILTER_PARAM,
} from './workflow-page.constants';
import { filterDefinitions, interpolate, workflowChatHref } from './workflow-page.utils';
import { resolveRunSessionKey } from './workflow-board.utils';
import { useWorkflowRunLive } from './use-workflow-run-live';

export function useWorkflowsPage() {
  const language = useLocaleStore((s) => s.language);
  const labels = messages(language).workflows;
  const localeTag = language === 'zh' ? 'zh-CN' : 'en-US';
  const token = useGatewayStore((s) => s.token);
  const hasToken = Boolean(token);
  const navigate = useNavigate();
  const [searchParams, setSearchParams] = useSearchParams();

  const searchQuery = searchParams.get(WORKFLOW_SEARCH_PARAM) ?? '';
  const workflowFilterId = searchParams.get(WORKFLOW_WF_FILTER_PARAM)?.trim() ?? '';
  const runParam = searchParams.get(WORKFLOW_RUN_PARAM)?.trim() ?? '';

  const [startDefinition, setStartDefinition] = useState<WorkflowDefinition | null>(null);
  const [pickStartOpen, setPickStartOpen] = useState(false);
  const [detailDefinition, setDetailDefinition] = useState<WorkflowDefinition | null>(null);
  const [manageOpen, setManageOpen] = useState(false);
  const [actionError, setActionError] = useState<string | null>(null);
  const [actionFeedback, setActionFeedback] = useState<string | null>(null);
  const [starting, setStarting] = useState(false);
  const [savingWorkflow, setSavingWorkflow] = useState(false);

  const definitionsSwr = useSWR(hasToken ? ['workflow-definitions', token] : null, listWorkflowDefinitions, {
    revalidateOnFocus: false,
  });
  const runsSwr = useSWR(hasToken ? ['workflow-runs', token] : null, () => listWorkflowRuns(RUN_FETCH_LIMIT), {
    revalidateOnFocus: false,
    refreshInterval: (latest) => {
      if (!latest?.length) return 0;
      const hasActive = latest.some((run) => run.status === 'queued' || run.status === 'running');
      return hasActive ? 3000 : 0;
    },
  });
  const statsSwr = useSWR(
    hasToken ? ['workflow-stats', token, workflowFilterId] : null,
    () => getWorkflowStats(workflowFilterId),
    { revalidateOnFocus: false },
  );

  useEffect(() => {
    if (!actionFeedback) return;
    const id = window.setTimeout(() => setActionFeedback(null), 4000);
    return () => window.clearTimeout(id);
  }, [actionFeedback]);

  const definitions = definitionsSwr.data ?? [];
  const runs = runsSwr.data ?? [];
  const selectedRunId = runParam || null;
  const selectedRunLive = useWorkflowRunLive(selectedRunId);

  const filteredDefinitions = useMemo(
    () => filterDefinitions(definitions, searchQuery, 'all', 'all'),
    [definitions, searchQuery],
  );

  const patchSearchParams = useCallback(
    (mutate: (next: URLSearchParams, prev: URLSearchParams) => void) => {
      setSearchParams(
        (prev) => {
          const next = new URLSearchParams(prev);
          mutate(next, prev);
          return next;
        },
        { replace: true },
      );
    },
    [setSearchParams],
  );

  const setSearchQuery = useCallback(
    (value: string) => {
      patchSearchParams((next) => {
        const trimmed = value.trim();
        if (trimmed) next.set(WORKFLOW_SEARCH_PARAM, trimmed);
        else next.delete(WORKFLOW_SEARCH_PARAM);
      });
    },
    [patchSearchParams],
  );

  const setWorkflowFilterId = useCallback(
    (value: string) => {
      patchSearchParams((next) => {
        const trimmed = value.trim();
        if (trimmed) next.set(WORKFLOW_WF_FILTER_PARAM, trimmed);
        else next.delete(WORKFLOW_WF_FILTER_PARAM);
      });
    },
    [patchSearchParams],
  );

  const openRunDetails = useCallback(
    (run: WorkflowRunSummary) => {
      patchSearchParams((next) => {
        next.set(WORKFLOW_RUN_PARAM, run.id);
      });
    },
    [patchSearchParams],
  );

  const closeRunDetails = useCallback(() => {
    patchSearchParams((next) => {
      next.delete(WORKFLOW_RUN_PARAM);
    });
  }, [patchSearchParams]);

  const openRunInChat = useCallback(
    (run: WorkflowRunSummary) => {
      const sessionKey = resolveRunSessionKey(run);
      if (sessionKey) {
        navigate(workflowChatHref(sessionKey));
      }
    },
    [navigate],
  );

  useEffect(() => {
    if (!searchParams.get(WORKFLOW_TAB_PARAM)) return;
    patchSearchParams((next) => {
      next.delete(WORKFLOW_TAB_PARAM);
    });
  }, [patchSearchParams, searchParams]);

  useEffect(() => {
    const defId = searchParams.get(WORKFLOW_DEF_PARAM);
    const shouldStart = searchParams.get(WORKFLOW_START_PARAM) === '1';
    if (!defId || !definitions.length) return;
    const definition = definitions.find((item) => item.id === defId || item.name === defId);
    if (!definition) return;
    if (shouldStart) {
      setStartDefinition(definition);
    } else {
      setDetailDefinition(definition);
    }
    patchSearchParams((next) => {
      next.delete(WORKFLOW_DEF_PARAM);
      next.delete(WORKFLOW_START_PARAM);
    });
  }, [definitions, patchSearchParams, searchParams]);

  useEffect(() => {
    const refreshRuns = () => {
      void runsSwr.mutate();
      void statsSwr.mutate();
    };
    window.addEventListener('workflow-event-appended', refreshRuns);
    window.addEventListener('workflow-run-updated', refreshRuns);
    window.addEventListener('workflow-run-error', refreshRuns);
    return () => {
      window.removeEventListener('workflow-event-appended', refreshRuns);
      window.removeEventListener('workflow-run-updated', refreshRuns);
      window.removeEventListener('workflow-run-error', refreshRuns);
    };
  }, [runsSwr, statsSwr]);

  const refreshAll = useCallback(() => {
    void definitionsSwr.mutate();
    void runsSwr.mutate();
    void statsSwr.mutate();
  }, [definitionsSwr, runsSwr, statsSwr]);

  const submitStart = useCallback(
    async (payload: { goal: string; input?: unknown; concurrency?: number; maxSubagents?: number }) => {
      if (!startDefinition) return;
      setStarting(true);
      setActionError(null);
      try {
        const result = await startWorkflowRun({
          definitionId: startDefinition.id,
          goal: payload.goal,
          input: payload.input,
          concurrency: payload.concurrency,
          maxSubagents: payload.maxSubagents,
        });
        setStartDefinition(null);
        await runsSwr.mutate();
        await statsSwr.mutate();
        setActionFeedback(labels.startSuccess);
        patchSearchParams((next) => {
          next.set(WORKFLOW_RUN_PARAM, result.runId);
        });
      } catch (err) {
        setActionError(err instanceof Error ? err.message : labels.startFailed);
      } finally {
        setStarting(false);
      }
    },
    [labels.startFailed, labels.startSuccess, patchSearchParams, runsSwr, startDefinition, statsSwr],
  );

  const cancelRun = useCallback(
    async (runId: string) => {
      try {
        await cancelWorkflowRun(runId);
        await runsSwr.mutate();
        await statsSwr.mutate();
      } catch (err) {
        const message = err instanceof Error ? err.message : labels.cancelFailed;
        if (/not active|already finished/i.test(message)) {
          await runsSwr.mutate();
          await statsSwr.mutate();
          return;
        }
        setActionError(message);
      }
    },
    [labels.cancelFailed, runsSwr, statsSwr],
  );

  const retryRun = useCallback(
    async (runId: string) => {
      try {
        const result = await retryWorkflowRun(runId);
        await runsSwr.mutate();
        await statsSwr.mutate();
        patchSearchParams((next) => {
          next.set(WORKFLOW_RUN_PARAM, result.runId);
        });
      } catch (err) {
        setActionError(err instanceof Error ? err.message : labels.retryFailed);
      }
    },
    [labels.retryFailed, patchSearchParams, runsSwr, statsSwr],
  );

  const saveCustomWorkflow = useCallback(
    async (payload: { name: string; script: string }) => {
      setSavingWorkflow(true);
      setActionError(null);
      try {
        await saveWorkflowDefinition(payload.name, payload.script);
        setManageOpen(false);
        await definitionsSwr.mutate();
        setActionFeedback(labels.saveWorkflowSuccess);
      } catch (err) {
        setActionError(err instanceof Error ? err.message : labels.saveWorkflowFailed);
      } finally {
        setSavingWorkflow(false);
      }
    },
    [definitionsSwr, labels.saveWorkflowFailed, labels.saveWorkflowSuccess],
  );

  const removeCustomWorkflow = useCallback(
    async (definition: WorkflowDefinition) => {
      if (definition.metadata.source !== 'user') return;
      if (!window.confirm(interpolate(labels.deleteConfirm, { name: definition.name }))) return;
      setActionError(null);
      try {
        await deleteWorkflowDefinition(definition.id);
        await definitionsSwr.mutate();
        setActionFeedback(labels.deleteWorkflowSuccess);
      } catch (err) {
        setActionError(err instanceof Error ? err.message : labels.deleteWorkflowFailed);
      }
    },
    [definitionsSwr, labels],
  );

  const loading = definitionsSwr.isLoading || runsSwr.isLoading;
  const error = definitionsSwr.error?.message ?? runsSwr.error?.message ?? null;

  return {
    language,
    localeTag,
    labels,
    hasToken,
    searchQuery,
    setSearchQuery,
    workflowFilterId,
    setWorkflowFilterId,
    definitions,
    filteredDefinitions,
    runs,
    selectedRunId,
    selectedRunView: selectedRunLive.view,
    selectedRunLoading: selectedRunLive.loading,
    selectedRunError: selectedRunLive.error?.message ?? null,
    openRunDetails,
    closeRunDetails,
    openRunInChat,
    pickStartOpen,
    setPickStartOpen,
    startDefinition,
    setStartDefinition,
    detailDefinition,
    setDetailDefinition,
    manageOpen,
    setManageOpen,
    actionError,
    actionFeedback,
    starting,
    savingWorkflow,
    loading,
    error,
    stats: statsSwr.data,
    refreshAll,
    submitStart,
    cancelRun,
    retryRun,
    saveCustomWorkflow,
    removeCustomWorkflow,
  };
}

export type WorkflowsPageVm = ReturnType<typeof useWorkflowsPage>;

/** Resolve run by id for legacy callers (e.g. tests). */
export async function fetchWorkflowRunById(runId: string) {
  return getWorkflowRun(runId);
}
