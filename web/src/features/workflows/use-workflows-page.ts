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
  getWorkflowStats,
  listWorkflowDefinitions,
  listWorkflowRuns,
  retryWorkflowRun,
  type WorkflowDefinition,
  type WorkflowRunSummary,
} from './workflow-api';
import {
  RUN_FETCH_LIMIT,
  WORKFLOW_AGENT_PARAM,
  WORKFLOW_SEARCH_PARAM,
  WORKFLOW_TRIGGER_FILTER_PARAM,
  WORKFLOW_VIEW_MODE_SET,
  WORKFLOW_VIEW_PARAM,
  WORKFLOW_WF_FILTER_PARAM,
  type WorkflowViewMode,
} from './workflow-page.constants';
import { filterDefinitions, interpolate, workflowChatHref } from './workflow-page.utils';
import { resolveRunSessionKey } from './workflow-board.utils';

export function useWorkflowsPage() {
  const language = useLocaleStore((state) => state.language);
  const labels = messages(language).workflows;
  const localeTag = language === 'zh' ? 'zh-CN' : 'en-US';
  const token = useGatewayStore((state) => state.token);
  const hasToken = Boolean(token);
  const navigate = useNavigate();
  const [searchParams, setSearchParams] = useSearchParams();

  const searchQuery = searchParams.get(WORKFLOW_SEARCH_PARAM) ?? '';
  const workflowFilterId = searchParams.get(WORKFLOW_WF_FILTER_PARAM)?.trim() ?? '';
  const triggerFilter = searchParams.get(WORKFLOW_TRIGGER_FILTER_PARAM)?.trim() || 'all';
  const viewParam = searchParams.get(WORKFLOW_VIEW_PARAM)?.trim() ?? '';
  const ownerAgentParam = searchParams.get(WORKFLOW_AGENT_PARAM)?.trim() ?? '';
  const viewMode: WorkflowViewMode = WORKFLOW_VIEW_MODE_SET.has(viewParam) ? (viewParam as WorkflowViewMode) : 'operations';
  const [actionError, setActionError] = useState<string | null>(null);
  const [actionFeedback, setActionFeedback] = useState<string | null>(null);

  const agentsSwr = useSWR(hasToken ? ['workflow-agents', token] : null, fetchGatewayAgents, { revalidateOnFocus: false });
  const ownerAgentId = useMemo(() => {
    const agents = agentsSwr.data?.agents ?? [];
    if (ownerAgentParam && (agents.length === 0 || agents.some((agent) => agent.id === ownerAgentParam))) return ownerAgentParam;
    return agentsSwr.data?.defaultId;
  }, [agentsSwr.data, ownerAgentParam]);
  const definitionsSwr = useSWR(hasToken ? ['workflow-definitions', token] : null, listWorkflowDefinitions, { revalidateOnFocus: false });
  const runsSwr = useSWR(
    hasToken && ownerAgentId ? ['workflow-runs', token, ownerAgentId] : null,
    () => listWorkflowRuns(RUN_FETCH_LIMIT, { ownerAgentId }),
    {
      revalidateOnFocus: false,
      refreshInterval: (latest) => latest?.some((run) => run.status === 'queued' || run.status === 'running') ? 3000 : 0,
    },
  );
  const statsSwr = useSWR(
    hasToken && ownerAgentId ? ['workflow-stats', token, ownerAgentId, workflowFilterId] : null,
    () => getWorkflowStats(workflowFilterId, { ownerAgentId }),
    { revalidateOnFocus: false },
  );

  const definitions = definitionsSwr.data ?? [];
  const runs = runsSwr.data ?? [];
  const filteredDefinitions = useMemo(() => filterDefinitions(definitions, searchQuery, 'all', 'all'), [definitions, searchQuery]);

  const patchSearchParams = useCallback((mutate: (next: URLSearchParams) => void) => {
    setSearchParams((previous) => {
      const next = new URLSearchParams(previous);
      mutate(next);
      return next;
    }, { replace: true });
  }, [setSearchParams]);

  const setSearchQuery = useCallback((value: string) => patchSearchParams((next) => {
    const trimmed = value.trim();
    if (trimmed) next.set(WORKFLOW_SEARCH_PARAM, trimmed);
    else next.delete(WORKFLOW_SEARCH_PARAM);
  }), [patchSearchParams]);
  const setOwnerAgentId = useCallback((value: string) => patchSearchParams((next) => {
    const trimmed = value.trim();
    if (trimmed) next.set(WORKFLOW_AGENT_PARAM, trimmed);
    else next.delete(WORKFLOW_AGENT_PARAM);
  }), [patchSearchParams]);
  const setWorkflowFilterId = useCallback((value: string) => patchSearchParams((next) => {
    const trimmed = value.trim();
    if (trimmed) next.set(WORKFLOW_WF_FILTER_PARAM, trimmed);
    else next.delete(WORKFLOW_WF_FILTER_PARAM);
  }), [patchSearchParams]);
  const setTriggerFilter = useCallback((value: string) => patchSearchParams((next) => {
    if (value && value !== 'all') next.set(WORKFLOW_TRIGGER_FILTER_PARAM, value);
    else next.delete(WORKFLOW_TRIGGER_FILTER_PARAM);
  }), [patchSearchParams]);
  const setViewMode = useCallback((value: WorkflowViewMode) => patchSearchParams((next) => {
    if (value === 'operations') next.delete(WORKFLOW_VIEW_PARAM);
    else next.set(WORKFLOW_VIEW_PARAM, value);
  }), [patchSearchParams]);

  const ownerSuffix = ownerAgentId ? `?agentId=${encodeURIComponent(ownerAgentId)}` : '';
  const openDefinitionDetails = useCallback((definition: WorkflowDefinition) => navigate(`/workflows/${definition.id}${ownerSuffix}`), [navigate, ownerSuffix]);
  const startWorkflow = openDefinitionDetails;
  const openWorkflowEditor = useCallback((definition: WorkflowDefinition) => {
    navigate(definition.metadata.source === 'user' ? `/workflows/${definition.id}/edit${ownerSuffix}` : `/workflows/new?copy=${encodeURIComponent(definition.id)}${ownerAgentId ? `&agentId=${encodeURIComponent(ownerAgentId)}` : ''}`);
  }, [navigate, ownerAgentId, ownerSuffix]);
  const openRunDetails = useCallback((run: WorkflowRunSummary) => navigate(`/workflows/runs/${run.id}${ownerSuffix}`), [navigate, ownerSuffix]);
  const openRunInChat = useCallback((run: WorkflowRunSummary) => {
    const sessionKey = resolveRunSessionKey(run);
    if (sessionKey) navigate(workflowChatHref(sessionKey));
  }, [navigate]);

  const cancelRun = useCallback(async (runId: string) => {
    try {
      await cancelWorkflowRun(runId, { ownerAgentId });
      await Promise.all([runsSwr.mutate(), statsSwr.mutate()]);
    } catch (cause) {
      setActionError(cause instanceof Error ? cause.message : labels.cancelFailed);
    }
  }, [labels.cancelFailed, ownerAgentId, runsSwr, statsSwr]);
  const retryRun = useCallback(async (runId: string) => {
    try {
      const result = await retryWorkflowRun(runId, { ownerAgentId });
      navigate(`/workflows/runs/${result.runId}${ownerSuffix}`);
    } catch (cause) {
      setActionError(cause instanceof Error ? cause.message : labels.retryFailed);
    }
  }, [labels.retryFailed, navigate, ownerAgentId, ownerSuffix]);
  const removeCustomWorkflow = useCallback(async (definition: WorkflowDefinition) => {
    if (definition.metadata.source !== 'user') return;
    if (!window.confirm(interpolate(labels.deleteConfirm, { name: definition.name }))) return;
    try {
      await deleteWorkflowDefinition(definition.id);
      await definitionsSwr.mutate();
      setActionFeedback(labels.deleteWorkflowSuccess);
    } catch (cause) {
      setActionError(cause instanceof Error ? cause.message : labels.deleteWorkflowFailed);
    }
  }, [definitionsSwr, labels]);

  useEffect(() => {
    if (!actionFeedback) return;
    const timer = window.setTimeout(() => setActionFeedback(null), 4000);
    return () => window.clearTimeout(timer);
  }, [actionFeedback]);
  useEffect(() => {
    const refresh = () => void Promise.all([runsSwr.mutate(), statsSwr.mutate()]);
    window.addEventListener('workflow-run-updated', refresh);
    window.addEventListener('workflow-run-error', refresh);
    return () => {
      window.removeEventListener('workflow-run-updated', refresh);
      window.removeEventListener('workflow-run-error', refresh);
    };
  }, [runsSwr, statsSwr]);

  const refreshAll = useCallback(() => {
    void Promise.all([agentsSwr.mutate(), definitionsSwr.mutate(), runsSwr.mutate(), statsSwr.mutate()]);
  }, [agentsSwr, definitionsSwr, runsSwr, statsSwr]);
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
    agentOptions: agentsSwr.data?.agents ?? [],
    setOwnerAgentId,
    workflowFilterId,
    setWorkflowFilterId,
    triggerFilter,
    setTriggerFilter,
    viewMode,
    setViewMode,
    definitions,
    filteredDefinitions,
    runs,
    openDefinitionDetails,
    startWorkflow,
    openWorkflowEditor,
    openRunDetails,
    openRunInChat,
    actionError,
    actionFeedback,
    loading,
    error,
    stats: statsSwr.data,
    refreshAll,
    cancelRun,
    retryRun,
    removeCustomWorkflow,
  };
}

export type WorkflowsPageVm = ReturnType<typeof useWorkflowsPage>;
