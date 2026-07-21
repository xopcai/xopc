import {
  useCallback,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
  type FormEvent,
} from 'react';
import { useNavigate, useParams, useSearchParams } from 'react-router-dom';
import useSWR from 'swr';
import { useGatewayConfigSwr } from '@/features/gateway/gateway-config-swr';
import { fetchCapabilityPresets } from '@/features/settings/capability-presets/capability-presets-api';
import {
  createGatewayAgent,
  deleteGatewayAgent,
  fetchGatewayAgents,
  parseGatewayBindingsFromConfig,
  patchTuiDefaultAgent,
  updateGatewayAgent,
  type GatewayAgentRow,
  type GatewayAgentsPayload,
} from '@/features/settings/agents-admin-api';
import { AGENTS_APP_LIST_PATH, agentsAppDetailPath } from '@/features/settings/agents/agents-app-path';
import { SETTINGS_BACK_PATH_STATE_KEY } from '@/features/settings/settings-nav-state';
import { suggestWorkspaceFromAgentName } from '@/features/settings/suggest-agent-workspace';
import { validateAgentIdForNewAgent } from '@/lib/agent-id';
import { messages } from '@/i18n/messages';
import { useGatewayStore } from '@/stores/gateway-store';
import { useLocaleStore } from '@/stores/locale-store';
import { usePageHeaderStore } from '@/stores/page-header-store';

import type { AgentsEditorPanelContentProps } from './agents-editor-panel-content';
import { AgentsSettingsToolbar } from './agents-settings-toolbar';
import { agentListDisplayDescription, agentListDisplayName } from './agent-display-names';
import { useAgentOverviewProfileMarkdown } from './hooks/use-agent-overview-profile-markdown';
import { useAgentProfileFiles } from './hooks/use-agent-profile-files';
import { useAgentsChannelBindings } from './hooks/use-agents-channel-bindings';
import { useAgentsSkillsCatalog } from './hooks/use-agents-skills-catalog';
import { useAgentsToolsSkillsLocalState } from './hooks/use-agents-tools-skills-local-state';
import { WEBCHAT_AGENT_STORAGE_KEY } from '@/features/chat/session/chat-session-defaults';

import type { AgentPanel } from './utils';
import {
  cleanTypedModelsForPatch,
  typedModelsRowsFromList,
  validateTypedModelsForSave,
  type AgentTypedModelRow,
} from './typed-models-lib';

function modelRowsForPresetReset(agent: GatewayAgentRow): AgentTypedModelRow[] {
  const presetRows = typedModelsRowsFromList(agent.typedModels.preset);
  if (presetRows.some((row) => row.id === agent.typedModels.defaultRole)) {
    return presetRows;
  }
  return typedModelsRowsFromList(agent.typedModels.effective);
}

function builtinDenyPolicyFromDisableSet(disableSet: Set<string>) {
  return Object.fromEntries(
    Array.from(disableSet)
      .map((id) => id.trim())
      .filter(Boolean)
      .toSorted((x, y) => x.localeCompare(y))
      .map((id) => [id, { mode: 'deny' as const }]),
  );
}

export function useAgentsSettingsPanel() {
  const language = useLocaleStore((s) => s.language);
  const m = messages(language);
  const a = m.agentsSettings;

  const [deleteDialogOpen, setDeleteDialogOpen] = useState(false);
  const [deleteTarget, setDeleteTarget] = useState<GatewayAgentRow | null>(null);
  const [deletePurge, setDeletePurge] = useState(false);
  const [deleteConfirmText, setDeleteConfirmText] = useState('');
  const cCron = m.cron;
  const chat = m.chat;
  const token = useGatewayStore((st) => st.token);
  const hasToken = Boolean(token);
  const [searchParams, setSearchParams] = useSearchParams();
  const navigate = useNavigate();
  const { agentId: routeAgentId } = useParams<{ agentId?: string }>();
  const setPageHeader = usePageHeaderStore((s) => s.setPageHeader);
  const clearPageHeader = usePageHeaderStore((s) => s.clearPageHeader);

  const agentsSwrKey = hasToken ? 'settings-gateway-agents' : null;
  const {
    data: swrAgentsData,
    error: swrAgentsError,
    isLoading: agentsLoading,
    mutate: mutateAgents,
  } = useSWR(agentsSwrKey, fetchGatewayAgents, { revalidateOnFocus: false });
  const {
    data: capabilityPresetsData,
    mutate: mutateCapabilityPresets,
  } = useSWR(hasToken ? 'settings-capability-presets' : null, fetchCapabilityPresets, {
    revalidateOnFocus: false,
  });

  const gatewayConfigSwr = useGatewayConfigSwr(hasToken);
  const { data: gatewayCfgData } = gatewayConfigSwr;

  const bindingsFromConfig = useMemo(
    () => parseGatewayBindingsFromConfig(gatewayCfgData?.payload?.config ?? {}),
    [gatewayCfgData],
  );

  const data: GatewayAgentsPayload | null = swrAgentsData ?? null;
  const defaultAgent = useMemo(() => {
    if (!data) return null;
    return data.agents.find((agent) => agent.id === data.defaultId) ?? data.agents[0] ?? null;
  }, [data]);
  const loading = Boolean(hasToken && agentsLoading);
  const [error, setError] = useState<string | null>(null);
  const loadError =
    swrAgentsError instanceof Error ? swrAgentsError.message : swrAgentsError ? a.loadError : null;
  const displayError = error ?? loadError;

  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [panel, setPanel] = useState<AgentPanel>('overview');

  const [createDisplayName, setCreateDisplayName] = useState('');
  const [createAgentId, setCreateAgentId] = useState('');
  const [createDescription, setCreateDescription] = useState('');
  const [createWorkspace, setCreateWorkspace] = useState('');
  const [createModel, setCreateModel] = useState('');
  const [createModalError, setCreateModalError] = useState<string | null>(null);
  const [addAgentModalOpen, setAddAgentModalOpen] = useState(false);
  const createWorkspaceSuggestedRef = useRef('');
  const [duplicateSourceId, setDuplicateSourceId] = useState<string | null>(null);
  const [createPresetIds, setCreatePresetIds] = useState<string[]>([]);
  const [busy, setBusy] = useState(false);
  const [listSearchQuery, setListSearchQuery] = useState('');
  const [tuiDefaultAgentDraft, setTuiDefaultAgentDraft] = useState('');

  const [editWorkspace, setEditWorkspace] = useState('');
  const [editModel, setEditModel] = useState('');
  const [editName, setEditName] = useState('');
  const [editDescription, setEditDescription] = useState('');

  const overviewSaveProfileMarkdownRef = useRef<(() => Promise<void>) | null>(null);
  const [savedFlash, setSavedFlash] = useState(false);

  const trackedAgentsSyncRef = useRef<{ data: GatewayAgentsPayload | null; routeAgentId?: string }>({
    data: null,
    routeAgentId: undefined,
  });
  if (
    data &&
    (data !== trackedAgentsSyncRef.current.data || routeAgentId !== trackedAgentsSyncRef.current.routeAgentId)
  ) {
    trackedAgentsSyncRef.current = { data, routeAgentId };
    if (routeAgentId && data.agents.some((x) => x.id === routeAgentId)) {
      setSelectedId(routeAgentId);
    } else {
      setSelectedId((prev) => {
        if (prev && data.agents.some((x) => x.id === prev)) {
          return prev;
        }
        return data.defaultId;
      });
    }
  }

  useEffect(() => {
    if (!data || !routeAgentId) {
      return;
    }
    if (!data.agents.some((x) => x.id === routeAgentId)) {
      navigate(AGENTS_APP_LIST_PATH, { replace: true });
    }
  }, [data, routeAgentId, navigate]);

  useEffect(() => {
    if (routeAgentId) {
      setPanel('overview');
    }
  }, [routeAgentId]);

  useEffect(() => {
    if (searchParams.get('panel') !== 'defaults') {
      return;
    }
    navigate(routeAgentId ? agentsAppDetailPath(routeAgentId) : AGENTS_APP_LIST_PATH, {
      replace: true,
      state: {
        [SETTINGS_BACK_PATH_STATE_KEY]: routeAgentId
          ? agentsAppDetailPath(routeAgentId)
          : AGENTS_APP_LIST_PATH,
      },
    });
  }, [searchParams, routeAgentId, navigate]);

  useEffect(() => {
    if (searchParams.get('focus') !== 'avatar' || !routeAgentId) {
      return;
    }
    setPanel('profile');
    if (loading || !data?.agents.some((x) => x.id === routeAgentId)) {
      return;
    }
    const t = window.setTimeout(() => {
      document.getElementById('agent-avatar-settings')?.scrollIntoView({
        behavior: 'smooth',
        block: 'center',
      });
      setSearchParams(
        (prev) => {
          const next = new URLSearchParams(prev);
          next.delete('focus');
          return next;
        },
        { replace: true },
      );
    }, 220);
    return () => window.clearTimeout(t);
  }, [searchParams, routeAgentId, loading, data, setSearchParams]);

  const selected = useMemo(
    () => data?.agents.find((x) => x.id === selectedId) ?? null,
    [data, selectedId],
  );

  const savedTuiDefaultAgentId = useMemo(() => {
    const config = gatewayCfgData?.payload?.config;
    if (!config || typeof config !== 'object' || Array.isArray(config)) return '';
    const tui = (config as { tui?: unknown }).tui;
    if (!tui || typeof tui !== 'object' || Array.isArray(tui)) return '';
    const id = (tui as { defaultAgent?: unknown }).defaultAgent;
    return typeof id === 'string' ? id.trim().toLowerCase() : '';
  }, [gatewayCfgData]);

  const effectiveTuiDefaultAgentId = useMemo(() => {
    if (!data) return savedTuiDefaultAgentId;
    if (savedTuiDefaultAgentId && data.agents.some((agent) => agent.id === savedTuiDefaultAgentId)) {
      return savedTuiDefaultAgentId;
    }
    return data.defaultId || data.agents[0]?.id || savedTuiDefaultAgentId;
  }, [data, savedTuiDefaultAgentId]);

  const tuiDefaultAgentUnavailable = Boolean(
    data &&
    savedTuiDefaultAgentId &&
    !data.agents.some((agent) => agent.id === savedTuiDefaultAgentId),
  );
  useEffect(() => {
    setTuiDefaultAgentDraft(tuiDefaultAgentUnavailable ? '' : savedTuiDefaultAgentId);
  }, [savedTuiDefaultAgentId, tuiDefaultAgentUnavailable]);

  const trackedSelectedIdRef = useRef<string | null>(null);
  const selectedTrackingKey = selected ? selected.id : null;
  if (selected && trackedSelectedIdRef.current !== selectedTrackingKey) {
    trackedSelectedIdRef.current = selectedTrackingKey;
    setEditWorkspace(selected.workspace);
    setEditModel(selected.model?.primary ?? '');
    setEditName(agentListDisplayName(selected, messages(language).agentsSettings));
    setEditDescription(agentListDisplayDescription(selected, messages(language).agentsSettings));
  } else if (!selected && trackedSelectedIdRef.current !== null) {
    trackedSelectedIdRef.current = null;
    setEditWorkspace('');
    setEditModel('');
    setEditName('');
    setEditDescription('');
  }

  const overviewProfile = useAgentOverviewProfileMarkdown({
    agentId: selected?.id ?? null,
    enabled: panel === 'profile' && Boolean(selected),
    saveRef: overviewSaveProfileMarkdownRef,
  });

  const profileFiles = useAgentProfileFiles({
    panel,
    selectedId,
    hasToken,
    dataAgentsLength: data?.agents.length,
    saveErrorMessage: a.saveError,
    setError,
  });

  const toolsSkills = useAgentsToolsSkillsLocalState({ panel, selected });

  const channels = useAgentsChannelBindings({
    panel,
    hasToken,
    bindingsFromConfig,
    gatewayCfgLoading: gatewayCfgData === undefined,
    selected,
    saveErrorMessage: a.saveError,
    setBusy,
    setError,
  });

  const skillsCatalog = useAgentsSkillsCatalog({ panel, hasToken });

  const applyCreateWorkspaceSuggestion = useCallback(() => {
    const next = suggestWorkspaceFromAgentName(createAgentId.trim() || createDisplayName);
    setCreateWorkspace((prev) => {
      if (prev === '' || prev === createWorkspaceSuggestedRef.current) {
        createWorkspaceSuggestedRef.current = next;
        return next;
      }
      return prev;
    });
  }, [createAgentId, createDisplayName]);

  const openAddAgentModal = useCallback(() => {
    createWorkspaceSuggestedRef.current = '';
    setCreateDisplayName('');
    setCreateAgentId('');
    setCreateDescription('');
    setCreateWorkspace('');
    setCreateModel('');
    setCreateModalError(null);
    setDuplicateSourceId(null);
    setCreatePresetIds([]);
    setAddAgentModalOpen(true);
  }, []);

  const makeAvailableAgentId = useCallback(
    (baseId: string) => {
      const existingIds = new Set(data?.agents.map((ag) => ag.id.toLowerCase()) ?? []);
      const normalizedBaseId = baseId.trim();
      if (!existingIds.has(normalizedBaseId.toLowerCase())) {
        return normalizedBaseId;
      }

      const firstCopyId = `${normalizedBaseId}${a.duplicateIdSuffix}`;
      if (!existingIds.has(firstCopyId.toLowerCase())) {
        return firstCopyId;
      }

      for (let copyIndex = 2; copyIndex < 1000; copyIndex += 1) {
        const candidateId = `${firstCopyId}-${copyIndex}`;
        if (!existingIds.has(candidateId.toLowerCase())) {
          return candidateId;
        }
      }

      return firstCopyId;
    },
    [a.duplicateIdSuffix, data],
  );

  const onSelectDuplicateSource = useCallback(
    (sourceId: string | null) => {
      setDuplicateSourceId(sourceId);
      if (!sourceId) {
        setCreatePresetIds([]);
        return;
      }

      const source = data?.agents.find((ag) => ag.id === sourceId);
      if (!source) return;
      const sourceName = source.name?.trim() ?? source.id;
      const duplicateName = a.duplicateName.replace('{{name}}', sourceName);
      const duplicateId = makeAvailableAgentId(source.id);
      const sourceDescription = source.description ?? '';
      createWorkspaceSuggestedRef.current = '';
      setCreateDisplayName(duplicateName);
      setCreateAgentId(duplicateId);
      setCreateDescription(sourceDescription);
      setCreateWorkspace(source.workspace);
      setCreateModel(source.model?.primary ?? '');
      setCreatePresetIds([...source.extends]);
      setCreateModalError(null);
    },
    [a.duplicateName, data, makeAvailableAgentId],
  );

  const openDuplicateAgentModal = useCallback(
    (sourceId: string) => {
      onSelectDuplicateSource(sourceId);
      setAddAgentModalOpen(true);
    },
    [onSelectDuplicateSource],
  );
  const agentsHeaderEnd = useMemo(
    () => (
      <AgentsSettingsToolbar
        a={a}
        busy={busy}
        listSearchQuery={listSearchQuery}
        onListSearchQueryChange={setListSearchQuery}
        onAddAgent={() => openAddAgentModal()}
      />
    ),
    [a, busy, listSearchQuery, openAddAgentModal],
  );

  useLayoutEffect(() => {
    if (!hasToken) {
      clearPageHeader();
      return () => clearPageHeader();
    }
    setPageHeader({
      startExtra: null,
      main: (
        <div className="min-w-0">
          <h1 className="truncate text-base font-semibold tracking-tight text-fg">{a.title}</h1>
        </div>
      ),
      end: agentsHeaderEnd,
    });
    return () => clearPageHeader();
  }, [a.title, agentsHeaderEnd, clearPageHeader, hasToken, setPageHeader]);

  async function onCreate(e: FormEvent) {
    e.preventDefault();
    const name = createDisplayName.trim();
    if (!name) {
      return;
    }
    const idRes = validateAgentIdForNewAgent(createAgentId, name);
    if (idRes.ok === false) {
      setCreateModalError(idRes.error);
      return;
    }
    const wsInput = createWorkspace.trim();
    const workspace = wsInput || suggestWorkspaceFromAgentName(createAgentId.trim() || name);
    if (!workspace) {
      return;
    }
    setBusy(true);
    setCreateModalError(null);
    try {
      const identityMd = [
        '# IDENTITY.md - Who Am I?',
        '',
        `- **Name:** ${name}`,
        `- **Description:** ${createDescription.trim()}`,
        `- **Language:** ${language}`,
        '- **Creature:** assistant',
        '- **Emoji:**',
        '- **Avatar:**',
        '',
      ].join('\n');
      const next = await createGatewayAgent({
        workspace,
        ...(createAgentId.trim() ? { id: createAgentId.trim() } : {}),
        ...(createModel.trim()
          ? { models: { defaultRole: 'deep', roles: { deep: { model: createModel.trim() } } } }
          : {}),
        profileFiles: { 'IDENTITY.md': identityMd },
        ...(duplicateSourceId ? { cloneFrom: duplicateSourceId } : {}),
        extends: createPresetIds,
      });
      const { createdAgentId, ...agentsPayload } = next;
      void mutateAgents(agentsPayload, { revalidate: false });
      setCreateDisplayName('');
      setCreateAgentId('');
      setCreateDescription('');
      setCreateWorkspace('');
      setCreateModel('');
      setCreateModalError(null);
      setAddAgentModalOpen(false);
      setSelectedId(createdAgentId);
      navigate(agentsAppDetailPath(createdAgentId));
    } catch (err) {
      setCreateModalError(err instanceof Error ? err.message : a.saveError);
    } finally {
      setBusy(false);
    }
  }

  async function onSetDefault(agent: GatewayAgentRow) {
    setBusy(true);
    setError(null);
    try {
      const next = await updateGatewayAgent(agent.id, { setDefault: true });
      void mutateAgents(next, { revalidate: false });
      setSelectedId(agent.id);
    } catch (err) {
      setError(err instanceof Error ? err.message : a.saveError);
    } finally {
      setBusy(false);
    }
  }

  async function onSaveTuiDefaultAgent() {
    const agentId = tuiDefaultAgentDraft.trim().toLowerCase();
    if (agentId && !data?.agents.some((agent) => agent.id === agentId)) {
      setError(a.tuiDefaultAgentInvalid);
      return;
    }
    setBusy(true);
    setError(null);
    try {
      await patchTuiDefaultAgent(agentId || null);
      await gatewayConfigSwr.mutate();
    } catch (err) {
      setError(err instanceof Error ? err.message : a.saveError);
    } finally {
      setBusy(false);
    }
  }

  async function onSetTuiDefaultAgent(agent: GatewayAgentRow) {
    setBusy(true);
    setError(null);
    try {
      await patchTuiDefaultAgent(agent.id);
      setTuiDefaultAgentDraft(agent.id);
      await gatewayConfigSwr.mutate();
    } catch (err) {
      setError(err instanceof Error ? err.message : a.saveError);
    } finally {
      setBusy(false);
    }
  }

  async function onClearTuiDefaultAgent() {
    setBusy(true);
    setError(null);
    try {
      await patchTuiDefaultAgent(null);
      setTuiDefaultAgentDraft('');
      await gatewayConfigSwr.mutate();
    } catch (err) {
      setError(err instanceof Error ? err.message : a.saveError);
    } finally {
      setBusy(false);
    }
  }

  async function performDelete(agent: GatewayAgentRow, purge: boolean) {
    setBusy(true);
    setError(null);
    try {
      const next = await deleteGatewayAgent(agent.id, purge);
      void mutateAgents(next, { revalidate: false });
      setSelectedId(next.defaultId);
      setPanel('overview');
      if (routeAgentId === agent.id) {
        navigate(AGENTS_APP_LIST_PATH, { replace: true });
      }
      setDeleteDialogOpen(false);
      setDeleteTarget(null);
      setDeleteConfirmText('');
    } catch (err) {
      setError(err instanceof Error ? err.message : a.saveError);
    } finally {
      setBusy(false);
    }
  }

  function onDelete(agent: GatewayAgentRow, purge: boolean) {
    if (agent.id === 'main') {
      return;
    }
    setDeleteTarget(agent);
    setDeletePurge(purge);
    setDeleteConfirmText('');
    setDeleteDialogOpen(true);
  }

  async function onSaveTools() {
    if (!selected) {
      return;
    }
    setBusy(true);
    setError(null);
    try {
      const next = await updateGatewayAgent(selected.id, {
        tools: { builtin: builtinDenyPolicyFromDisableSet(toolsSkills.toolEntryDisable) },
      });
      void mutateAgents(next, { revalidate: false });
    } catch (err) {
      setError(err instanceof Error ? err.message : a.saveError);
    } finally {
      setBusy(false);
    }
  }

  async function onClearToolsEntry() {
    if (!selected) {
      return;
    }
    setBusy(true);
    setError(null);
    try {
      const next = await updateGatewayAgent(selected.id, { tools: null });
      void mutateAgents(next, { revalidate: false });
      toolsSkills.setToolEntryDisable(new Set());
    } catch (err) {
      setError(err instanceof Error ? err.message : a.saveError);
    } finally {
      setBusy(false);
    }
  }

  async function onSaveModels() {
    if (!selected) {
      return;
    }
    const typedErr = validateTypedModelsForSave(toolsSkills.modelRows, {
      invalidId: a.typedModelsInvalidId,
      duplicateId: a.typedModelsDuplicateId,
      invalidModel: a.typedModelsInvalidModel,
    });
    if (typedErr) {
      setError(typedErr);
      return;
    }
    setBusy(true);
    setError(null);
    try {
      const next = await updateGatewayAgent(selected.id, {
        models: { roles: cleanTypedModelsForPatch(toolsSkills.modelRows)?.roles ?? {} },
      });
      void mutateAgents(next, { revalidate: false });
    } catch (err) {
      setError(err instanceof Error ? err.message : a.saveError);
    } finally {
      setBusy(false);
    }
  }

  async function onSaveRuntime(): Promise<boolean> {
    if (!selected) {
      return false;
    }
    const typedErr = validateTypedModelsForSave(toolsSkills.modelRows, {
      invalidId: a.typedModelsInvalidId,
      duplicateId: a.typedModelsDuplicateId,
      invalidModel: a.typedModelsInvalidModel,
    });
    if (typedErr) {
      setError(typedErr);
      return false;
    }
    setBusy(true);
    setError(null);
    try {
      const baselineRoles = cleanTypedModelsForPatch(
        typedModelsRowsFromList(selected.typedModels.effective),
      )?.roles ?? {};
      const draftRoles = cleanTypedModelsForPatch(toolsSkills.modelRows)?.roles ?? {};
      const modelsChanged = JSON.stringify(draftRoles) !== JSON.stringify(baselineRoles);
      const next = await updateGatewayAgent(selected.id, {
        workspace: editWorkspace.trim() || undefined,
        ...(toolsSkills.modelsResetRequested
          ? { models: null }
          : modelsChanged
            ? { models: { roles: draftRoles } }
            : {}),
      });
      void mutateAgents(next, { revalidate: false });
      toolsSkills.setModelsResetRequested(false);
      return true;
    } catch (err) {
      setError(err instanceof Error ? err.message : a.saveError);
      return false;
    } finally {
      setBusy(false);
    }
  }

  function onClearModelsEntry() {
    if (!selected) {
      return;
    }
    const resetRows = modelRowsForPresetReset(selected);
    setError(null);
    toolsSkills.replaceModelRows(resetRows);
    toolsSkills.setModelsResetRequested(true);
  }

  async function onSaveSkills() {
    if (!selected) {
      return;
    }
    setBusy(true);
    setError(null);
    try {
      const next = await updateGatewayAgent(selected.id, {
        skills: toolsSkills.skillsInherit
          ? null
          : [...toolsSkills.skillsPick].toSorted((x, y) => x.localeCompare(y)),
      });
      void mutateAgents(next, { revalidate: false });
    } catch (err) {
      setError(err instanceof Error ? err.message : a.saveError);
    } finally {
      setBusy(false);
    }
  }

  async function onUpdateAgentExtends(nextExtends: string[]) {
    if (!selected) {
      return;
    }
    setBusy(true);
    setError(null);
    try {
      const next = await updateGatewayAgent(selected.id, { extends: nextExtends });
      void mutateAgents(next, { revalidate: false });
      void mutateCapabilityPresets();
    } catch (err) {
      setError(err instanceof Error ? err.message : a.saveError);
    } finally {
      setBusy(false);
    }
  }
  const footerSaveNotApplicable = panel !== 'profile' && panel !== 'runtime';

  const runtimeDirty = (() => {
    if (!selected || panel !== 'runtime') return false;
    const baselineRoles = cleanTypedModelsForPatch(
      typedModelsRowsFromList(selected.typedModels.effective),
    )?.roles ?? {};
    const draftRoles = cleanTypedModelsForPatch(toolsSkills.modelRows)?.roles ?? {};
    return toolsSkills.modelsResetRequested || (
      editWorkspace.trim() !== selected.workspace ||
      JSON.stringify(draftRoles) !== JSON.stringify(baselineRoles)
    );
  })();

  const isCurrentPanelDirty = (() => {
    if (footerSaveNotApplicable) return false;
    if (!selected) return false;
    switch (panel) {
      case 'profile':
        return overviewProfile.dirty;
      case 'runtime':
        return runtimeDirty;
      default:
        return true;
    }
  })();

  const footerSaveDisabled = footerSaveNotApplicable || !isCurrentPanelDirty;

  function showSavedFlash() {
    setSavedFlash(true);
    setTimeout(() => setSavedFlash(false), 2000);
  }

  async function handleModalFooterSave() {
    switch (panel) {
      case 'profile': {
        setBusy(true);
        setError(null);
        try {
          await (overviewSaveProfileMarkdownRef.current?.() ?? Promise.resolve());
          await mutateAgents();
          showSavedFlash();
          return true;
        } catch (err) {
          setError(err instanceof Error ? err.message : a.saveError);
          return false;
        } finally {
          setBusy(false);
        }
      }
      case 'runtime':
        if (await onSaveRuntime()) {
          showSavedFlash();
          return true;
        }
        return false;
      default:
        return true;
    }
  }

  function onAgentModalOpenChange(open: boolean) {
    if (!open) {
      navigate(AGENTS_APP_LIST_PATH);
    }
  }

  const modalTitle = selected ? editName.trim() || agentListDisplayName(selected, a) : (routeAgentId ?? '');
  const modalSubtitle = selected?.id ?? routeAgentId ?? '';

  const handleTryInChat = useCallback(async () => {
    if (!selected) return;
    // Save current panel state before navigating
    if (!(await handleModalFooterSave())) return;
    profileFiles.saveProfileMarkdownDebounced.flush();
    // Set agent in localStorage and navigate to a new chat
    try {
      globalThis.localStorage?.setItem(WEBCHAT_AGENT_STORAGE_KEY, selected.id);
    } catch {
      /* noop */
    }
    navigate('/chat/new', { state: { agentId: selected.id, fromAgentEditor: true } });
  }, [selected, handleModalFooterSave, profileFiles.saveProfileMarkdownDebounced, navigate]);

  const editorPanelProps: AgentsEditorPanelContentProps = {
    a,
    chat,
    cCron,
    selected,
    panel,
    data,
    busy,
    editName,
    setEditName,
    editDescription,
    setEditDescription,
    editWorkspace,
    setEditWorkspace,
    editModel,
    defaultModel: defaultAgent?.model?.primary ?? '',
    defaultWorkspace: defaultAgent?.workspace ?? '',
    onSetDefault: () => {
      if (!selected) return;
      void onSetDefault(selected);
    },
    onSetTuiDefault: () => {
      if (!selected) return;
      void onSetTuiDefaultAgent(selected);
    },
    isTuiDefault: Boolean(selected && selected.id === effectiveTuiDefaultAgentId),
    isTuiDefaultInherited: Boolean(
      selected &&
      selected.id === effectiveTuiDefaultAgentId &&
      (!savedTuiDefaultAgentId || tuiDefaultAgentUnavailable),
    ),
    onDelete: (purge: boolean) => {
      if (!selected) return;
      void onDelete(selected, purge);
    },
    onTryInChat: () => void handleTryInChat(),
    capabilityPresets: capabilityPresetsData?.presets ?? [],
    defaultPresetId: capabilityPresetsData?.defaultPresetId,
    onUpdateAgentExtends: (nextExtends: string[]) => void onUpdateAgentExtends(nextExtends),
    onOpenCapabilityPreset: (presetId: string) => {
      navigate(
        presetId
          ? `/settings/capability-presets?preset=${encodeURIComponent(presetId)}`
          : '/settings/capability-presets',
      );
    },
    overviewProfile,
    filesLoading: profileFiles.filesLoading,
    files: profileFiles.files,
    activeFile: profileFiles.activeFile,
    setActiveFile: profileFiles.setActiveFile,
    filesViewMode: profileFiles.filesViewMode,
    setFilesViewMode: profileFiles.setFilesViewMode,
    fileDraft: profileFiles.fileDraft,
    setFileDraft: profileFiles.setFileDraft,
    fileSaving: profileFiles.fileSaving,
    profileFileLoading: profileFiles.profileFileLoading,
    profileEditorNonce: profileFiles.profileEditorNonce,
    toolEntryDisable: toolsSkills.toolEntryDisable,
    setToolEntryDisable: toolsSkills.setToolEntryDisable,
    onSaveTools: () => void onSaveTools(),
    onClearToolsEntry: () => void onClearToolsEntry(),
    modelRows: toolsSkills.modelRows,
    setModelRows: toolsSkills.setModelRows,
    onSaveModels: () => void onSaveModels(),
    onClearModelsEntry,
    skillsCatalogLoading: skillsCatalog.skillsCatalogLoading,
    catalogForPick: skillsCatalog.catalogForPick,
    skillsInherit: toolsSkills.skillsInherit,
    setSkillsInherit: toolsSkills.setSkillsInherit,
    skillsPick: toolsSkills.skillsPick,
    setSkillsPick: toolsSkills.setSkillsPick,
    onSaveSkills: () => void onSaveSkills(),
    bindingsLoading: channels.bindingsLoading,
    agentBindings: channels.agentBindings,
    bindChannelStatuses: channels.bindChannelStatuses,
    bindChannelsLoading: channels.bindChannelsLoading,
    useManualChannel: channels.useManualChannel,
    newBindChannel: channels.newBindChannel,
    setNewBindChannel: channels.setNewBindChannel,
    bindSessionChats: channels.bindSessionChats,
    bindSessionsLoading: channels.bindSessionsLoading,
    newBindSessionIdx: channels.newBindSessionIdx,
    setNewBindSessionIdx: channels.setNewBindSessionIdx,
    newBindCustomPeer: channels.newBindCustomPeer,
    setNewBindCustomPeer: channels.setNewBindCustomPeer,
    refreshBindSessions: channels.refreshBindSessions,
    onRemoveBinding: (rule) => void channels.onRemoveBinding(rule),
    onAddBinding: channels.onAddBinding,
  };

  return {
    hasToken,
    a,
    chat,
    language,
    data,
    savedTuiDefaultAgentId,
    effectiveTuiDefaultAgentId,
    tuiDefaultAgentDraft,
    setTuiDefaultAgentDraft,
    tuiDefaultAgentUnavailable,
    onSaveTuiDefaultAgent,
    onSetTuiDefaultAgent,
    onClearTuiDefaultAgent,
    onSetDefaultAgent: onSetDefault,
    loading,
    displayError,
    navigate,
    routeAgentId,
    busy,
    listSearchQuery,
    openAddAgentModal,
    openDuplicateAgentModal,
    duplicateSourceId,
    createPresetIds,
    setCreatePresetIds,
    onSelectDuplicateSource,
    panel,
    setPanel,
    modalTitle,
    modalSubtitle,
    footerSaveDisabled,
    savedFlash,
    handleModalFooterSave,
    onAgentModalOpenChange,
    addAgentModalOpen,
    setAddAgentModalOpen,
    createWorkspaceSuggestedRef,
    createModalError,
    setCreateModalError,
    createDisplayName,
    setCreateDisplayName,
    createAgentId,
    setCreateAgentId,
    createDescription,
    setCreateDescription,
    createWorkspace,
    setCreateWorkspace,
    createModel,
    setCreateModel,
    onCreate,
    currentLanguageLabel: language === 'zh' ? '中文' : 'English',
    applyCreateWorkspaceSuggestion,
    deleteDialogOpen,
    setDeleteDialogOpen,
    deletePurge,
    deleteTarget,
    setDeleteTarget,
    deleteConfirmText,
    setDeleteConfirmText,
    performDelete,
    editorPanelProps,
  };
}
