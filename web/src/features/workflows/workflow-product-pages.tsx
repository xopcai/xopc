import { ArrowLeft, CopyPlus, Pencil, Play } from 'lucide-react';
import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { Link, useNavigate, useParams, useSearchParams } from 'react-router-dom';
import useSWR from 'swr';

import { Button } from '@/components/ui/button';
import { Skeleton } from '@/components/ui/skeleton';
import { fetchGatewayAgents } from '@/features/settings/agents-admin-api';
import { messages } from '@/i18n/messages';
import { formatMediumDateTime } from '@/lib/date-formatters';
import { useGatewayStore } from '@/stores/gateway-store';
import { useLocaleStore } from '@/stores/locale-store';
import { usePageHeaderStore } from '@/stores/page-header-store';

import { WorkflowEditor, type WorkflowEditorInitialDraft } from './workflow-create-dialog';
import { definitionToManifest } from './workflow-definition-manifest';
import { WorkflowDefinitionGraph } from './workflow-definition-graph';
import { resolveWorkflowInputPayload, validateWorkflowInputEditorValue } from './workflow-input-editor.utils';
import { resolveWorkflowLocalizedCopy } from './workflow-meta-locale';
import { ACTIVE_RUN_STATUSES, type WorkflowRunPanelTab } from './workflow-page.constants';
import { WorkflowRunPanel } from './workflow-run-panel';
import { WorkflowRunSetupPanel, type WorkflowRunSetupValue } from './workflow-run-setup-panel';
import { useWorkflowRunLive } from './use-workflow-run-live';
import {
  parseWorkflowSaveConflict,
  suggestAvailableWorkflowName,
  type WorkflowSaveConflict,
} from './workflow-save-utils';
import {
  cancelWorkflowRun,
  getWorkflowRun,
  getWorkflowRunComparison,
  listWorkflowDefinitions,
  listWorkflowRuns,
  replayWorkflowRun,
  retryWorkflowRun,
  saveWorkflowDefinition,
  startWorkflowRun,
  type WorkflowDefinition,
  type WorkflowDefinitionManifest,
  type WorkflowGraph,
  type WorkflowRunReplayScope,
} from './workflow-api';

function useWorkflowOwnerAgent() {
  const token = useGatewayStore((state) => state.token);
  const [searchParams] = useSearchParams();
  const requestedAgentId = searchParams.get('agentId')?.trim() || undefined;
  const agents = useSWR(token ? ['workflow-route-agents', token] : null, fetchGatewayAgents, { revalidateOnFocus: false });
  const ownerAgentId = requestedAgentId ?? agents.data?.defaultId;
  return { ownerAgentId, loading: agents.isLoading };
}

function useWorkflowDefinition(definitionId: string | undefined) {
  const token = useGatewayStore((state) => state.token);
  const definitions = useSWR(token ? ['workflow-route-definitions', token] : null, listWorkflowDefinitions, { revalidateOnFocus: false });
  const definition = useMemo(
    () => definitions.data?.find((item) => item.id === definitionId || item.name === definitionId),
    [definitionId, definitions.data],
  );
  const upsertDefinition = useCallback(async (saved: WorkflowDefinition) => {
    await definitions.mutate((current) => [
      ...(current ?? []).filter((item) => item.id !== saved.id && item.name !== saved.name),
      saved,
    ], { revalidate: false });
  }, [definitions]);
  const refreshDefinitions = useCallback(async () => {
    await definitions.mutate();
  }, [definitions]);
  return {
    definition,
    definitions: definitions.data ?? [],
    loading: definitions.isLoading,
    error: definitions.error,
    upsertDefinition,
    refreshDefinitions,
  };
}

const emptyRunSetup = (): WorkflowRunSetupValue => ({ goal: '', argValues: {}, schemaInput: {}, concurrency: '', maxSubagents: '' });

export function WorkflowDetailPage() {
  const { definitionId } = useParams();
  const [searchParams] = useSearchParams();
  const navigate = useNavigate();
  const language = useLocaleStore((state) => state.language);
  const labels = messages(language).workflows;
  const localeTag = language === 'zh' ? 'zh-CN' : 'en-US';
  const setPageHeader = usePageHeaderStore((state) => state.setPageHeader);
  const clearPageHeader = usePageHeaderStore((state) => state.clearPageHeader);
  const { ownerAgentId } = useWorkflowOwnerAgent();
  const projectId = searchParams.get('projectId')?.trim() || undefined;
  const { definition, loading, error } = useWorkflowDefinition(definitionId);
  const runs = useSWR(
    ownerAgentId ? ['workflow-detail-runs', ownerAgentId, definitionId, projectId ?? ''] : null,
    () => listWorkflowRuns(100, { ownerAgentId, projectId }),
    { revalidateOnFocus: false },
  );
  const [setup, setSetup] = useState<WorkflowRunSetupValue>(emptyRunSetup);
  const [starting, setStarting] = useState(false);
  const [actionError, setActionError] = useState<string | null>(null);

  const recentRuns = useMemo(
    () => (runs.data ?? []).filter((run) => run.definitionId === definition?.id).slice(0, 6),
    [definition?.id, runs.data],
  );
  const inputValidity = validateWorkflowInputEditorValue(definition, setup);
  const localized = definition ? resolveWorkflowLocalizedCopy(definition, language) : null;

  const libraryParams = new URLSearchParams({ tab: 'library' });
  if (ownerAgentId) libraryParams.set('agentId', ownerAgentId);
  const libraryHref = `/workflows?${libraryParams.toString()}`;

  let editHref: string | null = null;
  if (definition) {
    const editQuery = new URLSearchParams();
    if (ownerAgentId) editQuery.set('agentId', ownerAgentId);
    if (projectId) editQuery.set('projectId', projectId);
    if (definition.metadata.source !== 'user') editQuery.set('copy', definition.id);
    editHref = `${definition.metadata.source === 'user' ? `/workflows/${definition.id}/edit` : '/workflows/new'}${editQuery.size ? `?${editQuery.toString()}` : ''}`;
  }

  useLayoutEffect(() => {
    const backLabel = language === 'zh' ? '返回工作流库' : 'Back to workflow library';
    setPageHeader({
      startExtra: (
        <Link to={libraryHref} className="inline-flex size-9 items-center justify-center rounded-lg text-fg-muted hover:bg-surface-hover hover:text-fg" aria-label={backLabel}>
          <ArrowLeft className="size-4" aria-hidden />
        </Link>
      ),
      main: (
        <div className="min-w-0">
          <h1 className="truncate text-base font-semibold tracking-tight text-fg">
            {definition?.title ?? (language === 'zh' ? '工作流详情' : 'Workflow details')}
          </h1>
          {definition ? (
            <p className="truncate text-xs text-fg-muted">
              {definition.metadata.source === 'user' ? labels.badgeUser : labels.badgeBuiltin}
              {' · '}
              {language === 'zh' ? `版本 ${definition.revision}` : `Version ${definition.revision}`}
            </p>
          ) : null}
        </div>
      ),
      end: definition && editHref ? (
        <Button asChild variant="secondary" className="h-9 shrink-0">
          <Link to={editHref}>
            {definition.metadata.source === 'user' ? <Pencil className="size-4" aria-hidden /> : <CopyPlus className="size-4" aria-hidden />}
            {definition.metadata.source === 'user' ? labels.editWorkflow : labels.copyAndEditWorkflow}
          </Link>
        </Button>
      ) : null,
    });
    return () => clearPageHeader();
  }, [clearPageHeader, definition, editHref, labels.badgeBuiltin, labels.badgeUser, labels.copyAndEditWorkflow, labels.editWorkflow, language, libraryHref, setPageHeader]);

  const start = useCallback(async () => {
    if (!definition || !inputValidity.valid || starting) return;
    setStarting(true);
    setActionError(null);
    try {
      const result = await startWorkflowRun({
        definitionId: definition.id,
        goal: setup.goal.trim() || localized?.description || definition.title,
        input: resolveWorkflowInputPayload(definition, setup),
        agentId: ownerAgentId,
        projectId,
        concurrency: setup.concurrency.trim() ? Number(setup.concurrency) : undefined,
        maxSubagents: setup.maxSubagents.trim() ? Number(setup.maxSubagents) : undefined,
      });
      navigate(`/workflows/runs/${result.runId}${ownerAgentId ? `?agentId=${encodeURIComponent(ownerAgentId)}` : ''}`);
    } catch (cause) {
      setActionError(cause instanceof Error ? cause.message : labels.startFailed);
    } finally {
      setStarting(false);
    }
  }, [definition, inputValidity.valid, labels.startFailed, localized?.description, navigate, ownerAgentId, projectId, setup, starting]);

  if (loading) return <WorkflowRouteSkeleton />;
  if (!definition || !localized) return <WorkflowRouteError message={error?.message ?? (language === 'zh' ? '没有找到这个工作流' : 'Workflow not found')} />;

  return (
    <main className="min-h-0 flex-1 overflow-y-auto bg-surface-panel">
      <div className="mx-auto w-full max-w-6xl px-4 py-5 sm:px-6">
        <p className="max-w-3xl text-sm leading-6 text-fg-muted">{localized.description}</p>

        <div className="mt-5 grid gap-5 xl:grid-cols-[minmax(0,1fr)_22rem]">
          <div className="min-w-0">
            <WorkflowDefinitionGraph graph={definition.graph} language={language} className="h-[28rem] rounded-xl border border-edge" />
          </div>

          <aside className="rounded-xl border border-edge bg-surface-base/45 p-4">
            <h2 className="text-base font-semibold text-fg">{language === 'zh' ? '开始一次运行' : 'Start a run'}</h2>
            <p className="mt-1 text-sm leading-6 text-fg-muted">{localized.whenToUse || localized.description}</p>
            <div className="mt-4">
              <WorkflowRunSetupPanel
                definition={definition}
                language={language}
                value={setup}
                onChange={setSetup}
                mode="manual"
                badgeLabel={labels.readyToStart}
                aiAssist={{ context: { surface: 'workflow-start', workflowId: definition.id, workflowName: definition.name, workflowTitle: definition.title, workflowDescription: localized.description } }}
              />
            </div>
            {actionError ? <p className="mt-3 text-sm text-danger">{actionError}</p> : null}
            <Button variant="primary" className="mt-4 w-full" disabled={!inputValidity.valid || starting} onClick={() => void start()}>
              <Play className="size-4" aria-hidden />
              {starting ? labels.starting : labels.runWorkflow}
            </Button>
          </aside>
        </div>

        <section className="mt-6 border-t border-edge pt-5">
          <h2 className="text-base font-semibold text-fg">{language === 'zh' ? '最近运行' : 'Recent runs'}</h2>
          {recentRuns.length ? (
            <div className="mt-3 grid gap-2 md:grid-cols-2 xl:grid-cols-3">
              {recentRuns.map((run) => (
                <button key={run.id} type="button" className="rounded-xl border border-edge bg-surface-base/40 p-3 text-left hover:bg-surface-hover" onClick={() => navigate(`/workflows/runs/${run.id}${ownerAgentId ? `?agentId=${encodeURIComponent(ownerAgentId)}` : ''}`)}>
                  <div className="flex items-center justify-between gap-3">
                    <span className="truncate text-sm font-medium text-fg">{run.title}</span>
                    <span className="shrink-0 text-xs text-fg-subtle">{labels.status[run.status]}</span>
                  </div>
                  <p className="mt-1 text-xs text-fg-muted">{formatMediumDateTime(run.createdAtMs, localeTag)}</p>
                </button>
              ))}
            </div>
          ) : <p className="mt-3 text-sm text-fg-muted">{language === 'zh' ? '还没有运行记录。' : 'No runs yet.'}</p>}
        </section>
      </div>
    </main>
  );
}

export function WorkflowEditorPage() {
  const { definitionId } = useParams();
  const [searchParams] = useSearchParams();
  const navigate = useNavigate();
  const language = useLocaleStore((state) => state.language);
  const { ownerAgentId } = useWorkflowOwnerAgent();
  const copyId = searchParams.get('copy')?.trim() || undefined;
  const repairRunId = searchParams.get('repairRun')?.trim() || undefined;
  const sourceId = definitionId ?? copyId;
  const { definition, definitions, loading, upsertDefinition, refreshDefinitions } = useWorkflowDefinition(sourceId);
  const repairRun = useSWR(repairRunId && ownerAgentId ? ['workflow-repair-run', repairRunId, ownerAgentId] : null, () => getWorkflowRun(repairRunId!, { ownerAgentId }), { revalidateOnFocus: false });
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [saveConflict, setSaveConflict] = useState<WorkflowSaveConflict | null>(null);
  const existingNames = useMemo(() => definitions.map((item) => item.name), [definitions]);
  const initialName = useMemo(
    () => suggestAvailableWorkflowName('my_workflow', existingNames),
    [existingNames],
  );

  const initialDraft = useMemo<WorkflowEditorInitialDraft | null>(() => {
    if (!definition) return null;
    const mode = definitionId && definition.metadata.source === 'user' ? 'edit' : 'copy';
    const repairFailures = repairRun.data?.nodes.filter((node) => node.status === 'error') ?? [];
    const repairDetails = repairFailures.map((node) => language === 'zh'
      ? `${node.title}：${node.error ?? '执行失败'}`
      : `${node.title}: ${node.error ?? 'execution failed'}`).join(language === 'zh' ? '；' : '; ')
      || repairRun.data?.run.error?.message
      || undefined;
    const repairPrompt = repairRunId && repairRun.data
      ? language === 'zh'
        ? `修复这次运行中的失败步骤，并保持原始目标不变：${repairDetails ?? '请根据运行记录定位失败原因'}`
        : `Repair the failed steps from this run while preserving the original goal: ${repairDetails ?? 'use the run record to identify the failure'}`
      : undefined;
    return {
      mode,
      name: mode === 'edit' ? definition.name : uniqueCopyName(definition.name, definitions),
      graph: structuredClone(definition.graph),
      manifest: definitionToManifest(definition),
      baseRevision: mode === 'edit' ? definition.revision : 0,
      sourceTitle: definition.title,
      repairPrompt,
    };
  }, [definition, definitionId, definitions, language, repairRun.data?.nodes, repairRunId]);

  const save = useCallback(async (payload: { name: string; graph: WorkflowGraph; manifest: WorkflowDefinitionManifest; expectedRevision: number }) => {
    setSaving(true);
    setError(null);
    setSaveConflict(null);
    try {
      const saved = await saveWorkflowDefinition(payload.name, payload.graph, payload.manifest, payload.expectedRevision);
      await upsertDefinition(saved);
      navigate(`/workflows/${saved.id}/edit`, { replace: true });
      return saved;
    } catch (cause) {
      const conflict = parseWorkflowSaveConflict(cause);
      setSaveConflict(conflict);
      if (!conflict) setError(cause instanceof Error ? cause.message : String(cause));
    } finally {
      setSaving(false);
    }
  }, [navigate, upsertDefinition]);

  const saveAndStart = useCallback(async (payload: { name: string; graph: WorkflowGraph; manifest: WorkflowDefinitionManifest; expectedRevision: number; goal: string }) => {
    setSaving(true);
    setError(null);
    setSaveConflict(null);
    try {
      const saved = await saveWorkflowDefinition(payload.name, payload.graph, payload.manifest, payload.expectedRevision);
      await upsertDefinition(saved);
      const result = await startWorkflowRun({ definitionId: saved.id, goal: payload.goal, input: { goal: payload.goal }, agentId: ownerAgentId });
      navigate(`/workflows/runs/${result.runId}${ownerAgentId ? `?agentId=${encodeURIComponent(ownerAgentId)}` : ''}`);
    } catch (cause) {
      const conflict = parseWorkflowSaveConflict(cause);
      setSaveConflict(conflict);
      if (!conflict) setError(cause instanceof Error ? cause.message : String(cause));
      throw cause;
    } finally {
      setSaving(false);
    }
  }, [navigate, ownerAgentId, upsertDefinition]);

  if (loading) return <WorkflowRouteSkeleton />;
  if (definitionId && !definition) return <WorkflowRouteError message={language === 'zh' ? '没有找到这个工作流' : 'Workflow not found'} />;

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      {error ? <div className="border-b border-danger/30 bg-danger/5 px-4 py-2 text-sm text-danger">{error}</div> : null}
      <WorkflowEditor
        language={language}
        ownerAgentId={ownerAgentId}
        saving={saving}
        initialDraft={initialDraft}
        initialName={initialName}
        existingNames={existingNames}
        saveConflict={saveConflict}
        onSave={save}
        onSaveAndStart={saveAndStart}
        onClearSaveConflict={() => setSaveConflict(null)}
        onReloadLatest={() => {
          setSaveConflict(null);
          setError(null);
          void refreshDefinitions();
        }}
      />
    </div>
  );
}

export function WorkflowRunPage() {
  const { runId } = useParams();
  const navigate = useNavigate();
  const language = useLocaleStore((state) => state.language);
  const localeTag = language === 'zh' ? 'zh-CN' : 'en-US';
  const { ownerAgentId } = useWorkflowOwnerAgent();
  const live = useWorkflowRunLive(runId, { ownerAgentId });
  const [activeTab, setActiveTab] = useState<WorkflowRunPanelTab>('process');
  const wasActiveRef = useRef(true);
  const comparison = useSWR(
    live.view?.run.metadata?.replay && runId ? ['workflow-run-page-comparison', runId, ownerAgentId] : null,
    () => getWorkflowRunComparison(runId!, { ownerAgentId }),
    { revalidateOnFocus: false },
  );

  const isActive = live.view ? ACTIVE_RUN_STATUSES.has(live.view.run.status) : true;
  useEffect(() => {
    if (wasActiveRef.current && !isActive) setActiveTab('result');
    wasActiveRef.current = isActive;
  }, [isActive]);

  const openNewRun = useCallback((nextRunId: string) => {
    navigate(`/workflows/runs/${nextRunId}${ownerAgentId ? `?agentId=${encodeURIComponent(ownerAgentId)}` : ''}`);
  }, [navigate, ownerAgentId]);

  const retry = useCallback(async () => {
    if (!runId) return;
    const result = await retryWorkflowRun(runId, { ownerAgentId });
    openNewRun(result.runId);
  }, [openNewRun, ownerAgentId, runId]);
  const replay = useCallback(async (scope: WorkflowRunReplayScope) => {
    if (!runId) return;
    const result = await replayWorkflowRun(runId, scope, { ownerAgentId });
    openNewRun(result.runId);
  }, [openNewRun, ownerAgentId, runId]);

  if (!live.loading && !live.view) {
    const message = live.error instanceof Error ? live.error.message : language === 'zh' ? '没有找到这次运行' : 'Workflow run not found';
    return <WorkflowRouteError message={message} />;
  }

  return (
    <WorkflowRunPanel
      view={live.view}
      comparison={comparison.data}
      loading={live.loading}
      language={language}
      localeTag={localeTag}
      activeTab={activeTab}
      onTabChange={setActiveTab}
      onCancel={() => runId && void cancelWorkflowRun(runId, { ownerAgentId }).then(() => live.mutate())}
      onRetry={() => void retry()}
      onReplay={(scope) => void replay(scope)}
      onOpenRunId={openNewRun}
      ownerAgentId={ownerAgentId}
      onRepairWorkflow={live.view ? () => navigate(`/workflows/${live.view!.run.definitionId}/edit?repairRun=${encodeURIComponent(live.view!.run.id)}${ownerAgentId ? `&agentId=${encodeURIComponent(ownerAgentId)}` : ''}`) : undefined}
    />
  );
}

function uniqueCopyName(name: string, definitions: WorkflowDefinition[]): string {
  const used = new Set(definitions.map((definition) => definition.name));
  const base = `${name}_copy`;
  if (!used.has(base)) return base;
  for (let index = 2; index < 100; index += 1) {
    const candidate = `${base}_${index}`;
    if (!used.has(candidate)) return candidate;
  }
  return `${base}_${Date.now()}`;
}

function WorkflowRouteSkeleton() {
  return (
    <main className="min-h-0 flex-1 overflow-auto bg-surface-panel p-5" aria-busy>
      <div className="mx-auto w-full max-w-6xl">
        <Skeleton className="h-5 w-36" />
        <Skeleton className="mt-5 h-9 w-80 max-w-full" />
        <Skeleton className="mt-4 h-[28rem] rounded-xl" />
      </div>
    </main>
  );
}

function WorkflowRouteError({ message }: { message: string }) {
  return (
    <main className="flex min-h-0 flex-1 items-center justify-center bg-surface-panel p-6 text-center">
      <div>
        <p className="text-sm text-danger">{message}</p>
        <Button asChild variant="secondary" className="mt-4"><Link to="/workflows"><ArrowLeft className="size-4" />Back</Link></Button>
      </div>
    </main>
  );
}
