import { useCallback, useEffect, useMemo, useState } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import useSWR from 'swr';

import { fetchGatewayAgents } from '@/features/settings/agents-admin-api';
import { messages } from '@/i18n/messages';
import { useGatewayStore } from '@/stores/gateway-store';
import { useLocaleStore } from '@/stores/locale-store';

import {
  cancelWorkflowRun,
  deleteWorkflowDefinition,
  getWorkflowRunComparison,
  getWorkflowStats,
  listWorkflowDefinitions,
  listWorkflowRuns,
  replayWorkflowRun,
  retryWorkflowRun,
  saveWorkflowDefinition,
  startWorkflowRun,
  type WorkflowDefinition,
  type WorkflowDefinitionManifest,
  type WorkflowGraph,
  type WorkflowRunSummary,
  type WorkflowRunReplayScope,
} from './workflow-api';
import {
  RUN_FETCH_LIMIT,
  WORKFLOW_AGENT_PARAM,
  WORKFLOW_COPY_PARAM,
  WORKFLOW_DEF_PARAM,
  WORKFLOW_RUN_PARAM,
  WORKFLOW_RUN_PANEL_TAB_SET,
  WORKFLOW_RUN_TAB_PARAM,
  WORKFLOW_SEARCH_PARAM,
  WORKFLOW_START_PARAM,
  WORKFLOW_TRIGGER_FILTER_PARAM,
  WORKFLOW_VIEW_MODE_SET,
  WORKFLOW_VIEW_PARAM,
  WORKFLOW_WF_FILTER_PARAM,
  type WorkflowRunPanelTab,
  type WorkflowViewMode,
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
  const triggerFilter = searchParams.get(WORKFLOW_TRIGGER_FILTER_PARAM)?.trim() || 'all';
  const runParam = searchParams.get(WORKFLOW_RUN_PARAM)?.trim() ?? '';
  const viewParam = searchParams.get(WORKFLOW_VIEW_PARAM)?.trim() ?? '';
  const runTabParam = searchParams.get(WORKFLOW_RUN_TAB_PARAM)?.trim() ?? '';
  const ownerAgentParam = searchParams.get(WORKFLOW_AGENT_PARAM)?.trim() ?? '';
  const viewMode: WorkflowViewMode = WORKFLOW_VIEW_MODE_SET.has(viewParam) ? (viewParam as WorkflowViewMode) : 'operations';
  const runTab: WorkflowRunPanelTab = WORKFLOW_RUN_PANEL_TAB_SET.has(runTabParam)
    ? (runTabParam as WorkflowRunPanelTab)
    : 'result';

  const [startDefinition, setStartDefinition] = useState<WorkflowDefinition | null>(null);
  const [pickStartOpen, setPickStartOpen] = useState(false);
  const [detailDefinition, setDetailDefinition] = useState<WorkflowDefinition | null>(null);
  const [manageOpen, setManageOpenState] = useState(false);
  const [workflowEditorDraft, setWorkflowEditorDraft] = useState<{
    mode: 'edit' | 'copy';
    definition: WorkflowDefinition;
    initialName: string;
    initialGraph: WorkflowGraph;
    initialManifest: WorkflowDefinitionManifest;
    baseRevision: number;
    repairPrompt?: string;
  } | null>(null);
  const [actionError, setActionError] = useState<string | null>(null);
  const [actionFeedback, setActionFeedback] = useState<string | null>(null);
  const [starting, setStarting] = useState(false);
  const [savingWorkflow, setSavingWorkflow] = useState(false);

  const agentsSwr = useSWR(hasToken ? ['workflow-agents', token] : null, fetchGatewayAgents, {
    revalidateOnFocus: false,
  });
  const ownerAgentId = useMemo(() => {
    const agents = agentsSwr.data?.agents ?? [];
    if (ownerAgentParam && agents.some((agent) => agent.id === ownerAgentParam)) return ownerAgentParam;
    if (ownerAgentParam && agents.length === 0) return ownerAgentParam;
    return agentsSwr.data?.defaultId ?? (ownerAgentParam || undefined);
  }, [agentsSwr.data, ownerAgentParam]);

  const definitionsSwr = useSWR(hasToken ? ['workflow-definitions', token] : null, listWorkflowDefinitions, {
    revalidateOnFocus: false,
  });
  const runsSwr = useSWR(hasToken && ownerAgentId ? ['workflow-runs', token, ownerAgentId] : null, () => listWorkflowRuns(RUN_FETCH_LIMIT, { ownerAgentId }), {
    revalidateOnFocus: false,
    refreshInterval: (latest) => {
      if (!latest?.length) return 0;
      const hasActive = latest.some((run) => run.status === 'queued' || run.status === 'running');
      return hasActive ? 3000 : 0;
    },
  });
  const statsSwr = useSWR(
    hasToken && ownerAgentId ? ['workflow-stats', token, ownerAgentId, workflowFilterId] : null,
    () => getWorkflowStats(workflowFilterId, { ownerAgentId }),
    { revalidateOnFocus: false },
  );

  useEffect(() => {
    if (!actionFeedback) return;
    const id = window.setTimeout(() => setActionFeedback(null), 4000);
    return () => window.clearTimeout(id);
  }, [actionFeedback]);

  const definitions = definitionsSwr.data ?? [];
  const agentOptions = agentsSwr.data?.agents ?? [];
  const runs = runsSwr.data ?? [];
  const selectedRunId = runParam || null;
  const selectedRunLive = useWorkflowRunLive(selectedRunId, { ownerAgentId });
  const selectedRunComparisonSwr = useSWR(
    hasToken && ownerAgentId && selectedRunId && selectedRunLive.view?.run.metadata?.replay
      ? ['workflow-run-comparison', token, ownerAgentId, selectedRunId]
      : null,
    () => getWorkflowRunComparison(selectedRunId as string, { ownerAgentId }),
    { revalidateOnFocus: false },
  );

  const filteredDefinitions = useMemo(
    () => filterDefinitions(definitions, searchQuery, 'all', 'all'),
    [definitions, searchQuery],
  );

  const setManageOpen = useCallback((next: boolean) => {
    if (next) setWorkflowEditorDraft(null);
    setManageOpenState(next);
  }, []);

  const buildWorkflowCopyName = useCallback(
    (definition: WorkflowDefinition) => {
      const usedNames = new Set(definitions.map((item) => item.name));
      const base = `${definition.name}_copy`;
      if (!usedNames.has(base)) return base;
      for (let index = 2; index < 100; index += 1) {
        const candidate = `${base}_${index}`;
        if (!usedNames.has(candidate)) return candidate;
      }
      return `${base}_${Date.now()}`;
    },
    [definitions],
  );

  const openWorkflowEditor = useCallback(
    (definition: WorkflowDefinition, forcedMode?: 'edit' | 'copy', repairPrompt?: string) => {
      const mode = forcedMode ?? (definition.metadata.source === 'user' ? 'edit' : 'copy');
      const initialName = mode === 'edit' ? definition.name : buildWorkflowCopyName(definition);
      setActionError(null);
      setPickStartOpen(false);
      setWorkflowEditorDraft({
        mode,
        definition,
        initialName,
        initialGraph: structuredClone(definition.graph),
        initialManifest: definitionToManifest(definition),
        baseRevision: mode === 'edit' ? definition.revision : 0,
        repairPrompt,
      });
      setManageOpenState(true);
    },
    [buildWorkflowCopyName],
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

  const openDefinitionDetails = useCallback((definition: WorkflowDefinition) => {
    patchSearchParams((next) => {
      next.set(WORKFLOW_DEF_PARAM, definition.id);
      next.delete(WORKFLOW_START_PARAM);
      next.delete(WORKFLOW_COPY_PARAM);
    });
  }, [patchSearchParams]);

  const closeDefinitionDetails = useCallback(() => {
    setDetailDefinition(null);
    patchSearchParams((next) => {
      next.delete(WORKFLOW_DEF_PARAM);
      next.delete(WORKFLOW_START_PARAM);
      next.delete(WORKFLOW_COPY_PARAM);
    });
  }, [patchSearchParams]);

  useEffect(() => {
    const agents = agentsSwr.data?.agents ?? [];
    if (!ownerAgentParam || agents.length === 0 || agents.some((agent) => agent.id === ownerAgentParam)) return;
    patchSearchParams((next) => {
      if (agentsSwr.data?.defaultId) next.set(WORKFLOW_AGENT_PARAM, agentsSwr.data.defaultId);
      else next.delete(WORKFLOW_AGENT_PARAM);
      next.delete(WORKFLOW_RUN_PARAM);
    });
  }, [agentsSwr.data, ownerAgentParam, patchSearchParams]);

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

  const setOwnerAgentId = useCallback(
    (value: string) => {
      patchSearchParams((next) => {
        const trimmed = value.trim();
        if (trimmed) next.set(WORKFLOW_AGENT_PARAM, trimmed);
        else next.delete(WORKFLOW_AGENT_PARAM);
        next.delete(WORKFLOW_RUN_PARAM);
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

  const setTriggerFilter = useCallback(
    (value: string) => {
      patchSearchParams((next) => {
        const trimmed = value.trim();
        if (trimmed && trimmed !== 'all') next.set(WORKFLOW_TRIGGER_FILTER_PARAM, trimmed);
        else next.delete(WORKFLOW_TRIGGER_FILTER_PARAM);
      });
    },
    [patchSearchParams],
  );

  const setViewMode = useCallback(
    (value: WorkflowViewMode) => {
      patchSearchParams((next) => {
        if (value === 'operations') next.delete(WORKFLOW_VIEW_PARAM);
        else next.set(WORKFLOW_VIEW_PARAM, value);
      });
    },
    [patchSearchParams],
  );

  const setRunTab = useCallback(
    (value: WorkflowRunPanelTab) => {
      patchSearchParams((next) => {
        if (value === 'result') next.delete(WORKFLOW_RUN_TAB_PARAM);
        else next.set(WORKFLOW_RUN_TAB_PARAM, value);
      });
    },
    [patchSearchParams],
  );

  const openRunDetails = useCallback(
    (run: WorkflowRunSummary) => {
      patchSearchParams((next) => {
        if (ownerAgentId) next.set(WORKFLOW_AGENT_PARAM, ownerAgentId);
        next.set(WORKFLOW_RUN_PARAM, run.id);
        next.delete(WORKFLOW_RUN_TAB_PARAM);
      });
    },
    [ownerAgentId, patchSearchParams],
  );

  const closeRunDetails = useCallback(() => {
    patchSearchParams((next) => {
      next.delete(WORKFLOW_RUN_PARAM);
      next.delete(WORKFLOW_RUN_TAB_PARAM);
    });
  }, [patchSearchParams]);

  const openRunDetailsById = useCallback(
    (runId: string) => {
      patchSearchParams((next) => {
        if (ownerAgentId) next.set(WORKFLOW_AGENT_PARAM, ownerAgentId);
        next.set(WORKFLOW_RUN_PARAM, runId);
        next.delete(WORKFLOW_RUN_TAB_PARAM);
      });
    },
    [ownerAgentId, patchSearchParams],
  );

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
    const defId = searchParams.get(WORKFLOW_DEF_PARAM);
    const shouldStart = searchParams.get(WORKFLOW_START_PARAM) === '1';
    const shouldCopy = searchParams.get(WORKFLOW_COPY_PARAM) === '1';
    if (!defId) {
      setDetailDefinition(null);
      return;
    }
    if (!definitions.length) return;
    const definition = definitions.find((item) => item.id === defId || item.name === defId);
    if (!definition) return;
    if (shouldCopy) {
      openWorkflowEditor(definition, 'copy');
    } else if (shouldStart) {
      setStartDefinition(definition);
    } else {
      setDetailDefinition(definition);
      return;
    }
    patchSearchParams((next) => {
      next.delete(WORKFLOW_DEF_PARAM);
      next.delete(WORKFLOW_START_PARAM);
      next.delete(WORKFLOW_COPY_PARAM);
    });
  }, [definitions, openWorkflowEditor, patchSearchParams, searchParams]);

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
    void agentsSwr.mutate();
    void definitionsSwr.mutate();
    void runsSwr.mutate();
    void statsSwr.mutate();
  }, [agentsSwr, definitionsSwr, runsSwr, statsSwr]);

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
          agentId: ownerAgentId,
          concurrency: payload.concurrency,
          maxSubagents: payload.maxSubagents,
        });
        setStartDefinition(null);
        await runsSwr.mutate();
        await statsSwr.mutate();
        setActionFeedback(labels.startSuccess);
        patchSearchParams((next) => {
          if (ownerAgentId) next.set(WORKFLOW_AGENT_PARAM, ownerAgentId);
          next.set(WORKFLOW_RUN_PARAM, result.runId);
          next.delete(WORKFLOW_RUN_TAB_PARAM);
        });
      } catch (err) {
        setActionError(err instanceof Error ? err.message : labels.startFailed);
      } finally {
        setStarting(false);
      }
    },
    [labels.startFailed, labels.startSuccess, ownerAgentId, patchSearchParams, runsSwr, startDefinition, statsSwr],
  );

  const cancelRun = useCallback(
    async (runId: string) => {
      try {
        await cancelWorkflowRun(runId, { ownerAgentId });
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
    [labels.cancelFailed, ownerAgentId, runsSwr, statsSwr],
  );

  const retryRun = useCallback(
    async (runId: string) => {
      try {
        const result = await retryWorkflowRun(runId, { ownerAgentId });
        await runsSwr.mutate();
        await statsSwr.mutate();
        patchSearchParams((next) => {
          if (ownerAgentId) next.set(WORKFLOW_AGENT_PARAM, ownerAgentId);
          next.set(WORKFLOW_RUN_PARAM, result.runId);
          next.delete(WORKFLOW_RUN_TAB_PARAM);
        });
      } catch (err) {
        setActionError(err instanceof Error ? err.message : labels.retryFailed);
      }
    },
    [labels.retryFailed, ownerAgentId, patchSearchParams, runsSwr, statsSwr],
  );

  const replayRun = useCallback(
    async (runId: string, scope: WorkflowRunReplayScope) => {
      try {
        const result = await replayWorkflowRun(runId, scope, { ownerAgentId });
        await runsSwr.mutate();
        await statsSwr.mutate();
        patchSearchParams((next) => {
          if (ownerAgentId) next.set(WORKFLOW_AGENT_PARAM, ownerAgentId);
          next.set(WORKFLOW_RUN_PARAM, result.runId);
          next.delete(WORKFLOW_RUN_TAB_PARAM);
        });
      } catch (err) {
        setActionError(err instanceof Error ? err.message : labels.retryFailed);
      }
    },
    [labels.retryFailed, ownerAgentId, patchSearchParams, runsSwr, statsSwr],
  );

  const saveCustomWorkflow = useCallback(
    async (payload: { name: string; graph: WorkflowGraph; manifest: WorkflowDefinitionManifest; expectedRevision: number }): Promise<WorkflowDefinition | void> => {
      setSavingWorkflow(true);
      setActionError(null);
      try {
        const definition = await saveWorkflowDefinition(payload.name, payload.graph, payload.manifest, payload.expectedRevision);
        setManageOpenState(false);
        setWorkflowEditorDraft(null);
        await definitionsSwr.mutate();
        setActionFeedback(labels.saveWorkflowSuccess);
        return definition;
      } catch (err) {
        setActionError(err instanceof Error ? err.message : labels.saveWorkflowFailed);
      } finally {
        setSavingWorkflow(false);
      }
    },
    [definitionsSwr, labels.saveWorkflowFailed, labels.saveWorkflowSuccess],
  );

  const saveDraftAndStart = useCallback(
    async (payload: { name: string; graph: WorkflowGraph; manifest: WorkflowDefinitionManifest; expectedRevision: number; goal: string }) => {
      setSavingWorkflow(true);
      setActionError(null);
      try {
        const definition = await saveWorkflowDefinition(payload.name, payload.graph, payload.manifest, payload.expectedRevision);
        await definitionsSwr.mutate();
        const result = await startWorkflowRun({
          definitionId: definition.id,
          goal: payload.goal,
          input: { goal: payload.goal },
          agentId: ownerAgentId,
        });
        setManageOpenState(false);
        setWorkflowEditorDraft(null);
        await runsSwr.mutate();
        await statsSwr.mutate();
        setActionFeedback(labels.startSuccess);
        patchSearchParams((next) => {
          if (ownerAgentId) next.set(WORKFLOW_AGENT_PARAM, ownerAgentId);
          next.set(WORKFLOW_RUN_PARAM, result.runId);
          next.delete(WORKFLOW_RUN_TAB_PARAM);
        });
      } catch (err) {
        setActionError(err instanceof Error ? err.message : labels.startFailed);
        throw err;
      } finally {
        setSavingWorkflow(false);
      }
    },
    [definitionsSwr, labels.startFailed, labels.startSuccess, ownerAgentId, patchSearchParams, runsSwr, statsSwr],
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

  const loading = agentsSwr.isLoading || definitionsSwr.isLoading || runsSwr.isLoading;
  const error = agentsSwr.error?.message ?? definitionsSwr.error?.message ?? runsSwr.error?.message ?? null;

  return {
    language,
    localeTag,
    labels,
    hasToken,
    searchQuery,
    setSearchQuery,
    ownerAgentId,
    agentOptions,
    setOwnerAgentId,
    workflowFilterId,
    setWorkflowFilterId,
    triggerFilter,
    setTriggerFilter,
    viewMode,
    setViewMode,
    runTab,
    setRunTab,
    definitions,
    filteredDefinitions,
    runs,
    selectedRunId,
    selectedRunView: selectedRunLive.view,
    selectedRunComparison: selectedRunComparisonSwr.data,
    selectedRunLoading: selectedRunLive.loading,
    selectedRunError: selectedRunLive.error?.message ?? selectedRunComparisonSwr.error?.message ?? null,
    openRunDetails,
    closeRunDetails,
    openRunDetailsById,
    openRunInChat,
    pickStartOpen,
    setPickStartOpen,
    startDefinition,
    setStartDefinition,
    detailDefinition,
    openDefinitionDetails,
    closeDefinitionDetails,
    manageOpen,
    setManageOpen,
    workflowEditorDraft,
    openWorkflowEditor,
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
    replayRun,
    saveCustomWorkflow,
    saveDraftAndStart,
    removeCustomWorkflow,
  };
}

function definitionToManifest(definition: WorkflowDefinition): WorkflowDefinitionManifest {
  return {
    title: definition.title,
    description: definition.description,
    version: definition.version,
    inputSchema: definition.inputSchema,
    outputSchema: definition.outputSchema,
    defaults: definition.defaults,
    tags: definition.metadata.tags,
    whenToUse: definition.metadata.whenToUse,
    estimatedAgents: definition.metadata.estimatedAgents,
    permissions: definition.permissions,
    resources: definition.resources,
  };
}

export type WorkflowsPageVm = ReturnType<typeof useWorkflowsPage>;
