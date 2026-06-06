import { useCallback, useEffect, useMemo, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
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
  type WorkflowRunView,
} from './workflow-api';
import {
  ACTIVE_RUN_STATUSES,
  RUN_FETCH_LIMIT,
  WORKFLOW_DEF_PARAM,
  WORKFLOW_MAIN_TAB_SET,
  WORKFLOW_RUN_PARAM,
  WORKFLOW_SEARCH_PARAM,
  WORKFLOW_START_PARAM,
  WORKFLOW_TAB_PARAM,
  type WorkflowCategoryFilter,
  type WorkflowMainTab,
  type WorkflowSourceFilter,
} from './workflow-page.constants';
import { filterDefinitions, filterRunsByTab, interpolate } from './workflow-page.utils';

function resolveMainTab(searchParams: URLSearchParams): WorkflowMainTab {
  const tabRaw = searchParams.get(WORKFLOW_TAB_PARAM);
  return WORKFLOW_MAIN_TAB_SET.has(tabRaw ?? '') ? (tabRaw as WorkflowMainTab) : 'catalog';
}

export function useWorkflowsPage() {
  const language = useLocaleStore((s) => s.language);
  const labels = messages(language).workflows;
  const localeTag = language === 'zh' ? 'zh-CN' : 'en-US';
  const token = useGatewayStore((s) => s.token);
  const hasToken = Boolean(token);
  const [searchParams, setSearchParams] = useSearchParams();

  const mainTab = resolveMainTab(searchParams);
  const searchQuery = searchParams.get(WORKFLOW_SEARCH_PARAM) ?? '';
  const runParam = searchParams.get(WORKFLOW_RUN_PARAM)?.trim() ?? '';
  const selectedRunId = mainTab === 'catalog' ? '' : runParam;

  const [categoryFilter, setCategoryFilter] = useState<WorkflowCategoryFilter>('all');
  const [sourceFilter, setSourceFilter] = useState<WorkflowSourceFilter>('all');
  const [startDefinition, setStartDefinition] = useState<WorkflowDefinition | null>(null);
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
  });
  const statsSwr = useSWR(hasToken ? ['workflow-stats', token] : null, getWorkflowStats, {
    revalidateOnFocus: false,
  });

  const detailSwr = useSWR(
    hasToken && selectedRunId ? ['workflow-run', selectedRunId, token] : null,
    () => getWorkflowRun(selectedRunId),
    {
      revalidateOnFocus: false,
      keepPreviousData: false,
      refreshInterval: (latest) => {
        if (!latest) return 0;
        return latest.run.status === 'queued' || latest.run.status === 'running' ? 3000 : 0;
      },
    },
  );

  useEffect(() => {
    if (!actionFeedback) return;
    const id = window.setTimeout(() => setActionFeedback(null), 4000);
    return () => window.clearTimeout(id);
  }, [actionFeedback]);

  const definitions = definitionsSwr.data ?? [];
  const runs = runsSwr.data ?? [];

  const filteredDefinitions = useMemo(
    () => filterDefinitions(definitions, searchQuery, categoryFilter, sourceFilter),
    [definitions, searchQuery, categoryFilter, sourceFilter],
  );

  const activeRuns = useMemo(() => filterRunsByTab(runs, 'active'), [runs]);
  const historyRuns = useMemo(() => filterRunsByTab(runs, 'history'), [runs]);
  const visibleRuns = mainTab === 'active' ? activeRuns : historyRuns;

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

  const setMainTab = useCallback(
    (tab: WorkflowMainTab) => {
      patchSearchParams((next) => {
        next.set(WORKFLOW_TAB_PARAM, tab);
        if (tab === 'catalog') {
          next.delete(WORKFLOW_RUN_PARAM);
          return;
        }
        const list = tab === 'active' ? activeRuns : historyRuns;
        const current = next.get(WORKFLOW_RUN_PARAM)?.trim();
        if (current && list.some((run) => run.id === current)) return;
        if (list[0]?.id) {
          next.set(WORKFLOW_RUN_PARAM, list[0].id);
        } else if (!runsSwr.isLoading) {
          next.delete(WORKFLOW_RUN_PARAM);
        }
      });
    },
    [activeRuns, historyRuns, patchSearchParams, runsSwr.isLoading],
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

  const selectRun = useCallback(
    (runId: string) => {
      patchSearchParams((next) => {
        next.set(WORKFLOW_RUN_PARAM, runId);
      });
    },
    [patchSearchParams],
  );

  // Repair stale URLs like ?tab=catalog&run=…
  useEffect(() => {
    if (mainTab !== 'catalog' || !runParam) return;
    patchSearchParams((next) => {
      next.delete(WORKFLOW_RUN_PARAM);
    });
  }, [mainTab, patchSearchParams, runParam]);

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
  }, [definitions, searchParams]);

  // Deep link: ?run= without ?tab= → open the matching run tab.
  useEffect(() => {
    if (searchParams.get(WORKFLOW_TAB_PARAM) || !runParam || !runs.length) return;
    const run = runs.find((item) => item.id === runParam);
    if (!run) return;
    const tab: WorkflowMainTab = ACTIVE_RUN_STATUSES.has(run.status) ? 'active' : 'history';
    patchSearchParams((next) => {
      next.set(WORKFLOW_TAB_PARAM, tab);
      next.set(WORKFLOW_RUN_PARAM, runParam);
    });
  }, [patchSearchParams, runParam, runs, searchParams]);

  // On run tabs, ensure the selected run belongs to the visible list.
  useEffect(() => {
    if (mainTab === 'catalog' || runsSwr.isLoading) return;
    const list = mainTab === 'active' ? activeRuns : historyRuns;
    if (!list.length) {
      if (runParam) {
        patchSearchParams((next) => {
          next.delete(WORKFLOW_RUN_PARAM);
        });
      }
      return;
    }
    if (runParam && list.some((run) => run.id === runParam)) return;
    patchSearchParams((next) => {
      next.set(WORKFLOW_RUN_PARAM, list[0].id);
    });
  }, [activeRuns, historyRuns, mainTab, patchSearchParams, runParam, runsSwr.isLoading]);

  useEffect(() => {
    const refreshRuns = () => void runsSwr.mutate();
    const refreshDetail = (event: Event) => {
      const detail = (event as CustomEvent<{ runId?: string; view?: WorkflowRunView }>).detail;
      void runsSwr.mutate();
      void statsSwr.mutate();
      if (detail?.runId && detail.runId === selectedRunId) {
        void detailSwr.mutate(detail.view, { revalidate: false });
      }
    };
    window.addEventListener('workflow-event-appended', refreshRuns);
    window.addEventListener('workflow-run-updated', refreshDetail);
    window.addEventListener('workflow-run-error', refreshRuns);
    return () => {
      window.removeEventListener('workflow-event-appended', refreshRuns);
      window.removeEventListener('workflow-run-updated', refreshDetail);
      window.removeEventListener('workflow-run-error', refreshRuns);
    };
  }, [detailSwr, runsSwr, selectedRunId, statsSwr]);

  const refreshAll = useCallback(() => {
    void definitionsSwr.mutate();
    void runsSwr.mutate();
    void statsSwr.mutate();
    void detailSwr.mutate();
  }, [definitionsSwr, detailSwr, runsSwr, statsSwr]);

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
        patchSearchParams((next) => {
          next.set(WORKFLOW_TAB_PARAM, 'active');
          next.set(WORKFLOW_RUN_PARAM, result.runId);
        });
        await runsSwr.mutate();
        await statsSwr.mutate();
        setActionFeedback(labels.startSuccess);
      } catch (err) {
        setActionError(err instanceof Error ? err.message : labels.startFailed);
      } finally {
        setStarting(false);
      }
    },
    [labels.startFailed, labels.startSuccess, patchSearchParams, runsSwr, startDefinition, statsSwr],
  );

  const cancelSelectedRun = useCallback(async () => {
    if (!selectedRunId) return;
    try {
      await cancelWorkflowRun(selectedRunId);
      await runsSwr.mutate();
      await detailSwr.mutate();
    } catch (err) {
      const message = err instanceof Error ? err.message : labels.cancelFailed;
      if (/not active|already finished/i.test(message)) {
        await runsSwr.mutate();
        await detailSwr.mutate();
        return;
      }
      setActionError(message);
    }
  }, [detailSwr, labels.cancelFailed, runsSwr, selectedRunId]);

  const retrySelectedRun = useCallback(async () => {
    if (!selectedRunId) return;
    try {
      const result = await retryWorkflowRun(selectedRunId);
      patchSearchParams((next) => {
        next.set(WORKFLOW_TAB_PARAM, 'active');
        next.set(WORKFLOW_RUN_PARAM, result.runId);
      });
      await runsSwr.mutate();
      await statsSwr.mutate();
    } catch (err) {
      setActionError(err instanceof Error ? err.message : labels.retryFailed);
    }
  }, [labels.retryFailed, patchSearchParams, runsSwr, selectedRunId, statsSwr]);

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
  const runView = detailSwr.data?.run.id === selectedRunId ? detailSwr.data : undefined;
  const runLoading = Boolean(selectedRunId) && !runView && detailSwr.isLoading;

  return {
    language,
    localeTag,
    labels,
    hasToken,
    mainTab,
    setMainTab,
    searchQuery,
    setSearchQuery,
    categoryFilter,
    setCategoryFilter,
    sourceFilter,
    setSourceFilter,
    filteredDefinitions,
    activeRuns,
    historyRuns,
    visibleRuns,
    selectedRunId,
    selectRun,
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
    runView,
    runLoading,
    refreshAll,
    submitStart,
    cancelSelectedRun,
    retrySelectedRun,
    saveCustomWorkflow,
    removeCustomWorkflow,
  };
}

export type WorkflowsPageVm = ReturnType<typeof useWorkflowsPage>;
