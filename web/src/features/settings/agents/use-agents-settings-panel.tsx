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
import {
  createGatewayAgent,
  deleteGatewayAgent,
  fetchGatewayAgents,
  parseGatewayBindingsFromConfig,
  updateGatewayAgent,
  type GatewayAgentRow,
  type GatewayAgentsPayload,
} from '@/features/settings/agents-admin-api';
import { parseAgentDefaultsFromConfig } from '@/features/settings/config-api';
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
import { agentListDisplayName } from './agent-display-names';
import { useAgentProfileFiles } from './hooks/use-agent-profile-files';
import { useAgentsChannelBindings } from './hooks/use-agents-channel-bindings';
import { useAgentsCronJobs } from './hooks/use-agents-cron-jobs';
import { useAgentsSkillsCatalog } from './hooks/use-agents-skills-catalog';
import { useAgentsToolsSkillsLocalState } from './hooks/use-agents-tools-skills-local-state';
import { PRESET_AGENTS_SKIPPED_KEY } from './preset-agents';
import type { AgentPanel } from './utils';

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

  const { data: gatewayCfgData } = useGatewayConfigSwr(hasToken);

  const bindingsFromConfig = useMemo(
    () => parseGatewayBindingsFromConfig(gatewayCfgData?.payload?.config ?? {}),
    [gatewayCfgData],
  );

  const globalAgentDefaults = useMemo(
    () => parseAgentDefaultsFromConfig(gatewayCfgData?.payload?.config ?? {}),
    [gatewayCfgData],
  );

  const data: GatewayAgentsPayload | null = swrAgentsData ?? null;
  const loading = Boolean(hasToken && agentsLoading);
  const [error, setError] = useState<string | null>(null);
  const loadError =
    swrAgentsError instanceof Error ? swrAgentsError.message : swrAgentsError ? a.loadError : null;
  const displayError = error ?? loadError;

  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [showPresetSetup, setShowPresetSetup] = useState(false);
  const [panel, setPanel] = useState<AgentPanel>('overview');

  const [createDisplayName, setCreateDisplayName] = useState('');
  const [createAgentId, setCreateAgentId] = useState('');
  const [createDescription, setCreateDescription] = useState('');
  const [createWorkspace, setCreateWorkspace] = useState('');
  const [createModel, setCreateModel] = useState('');
  const [createModalError, setCreateModalError] = useState<string | null>(null);
  const [addAgentModalOpen, setAddAgentModalOpen] = useState(false);
  const createWorkspaceSuggestedRef = useRef('');
  const [busy, setBusy] = useState(false);
  const [listSearchQuery, setListSearchQuery] = useState('');

  const [editWorkspace, setEditWorkspace] = useState('');
  const [editModel, setEditModel] = useState('');
  const [editName, setEditName] = useState('');
  const [editDescription, setEditDescription] = useState('');

  const profileSaveRef = useRef<(() => Promise<void>) | null>(null);
  const [overviewProfileMarkdownDirty, setOverviewProfileMarkdownDirty] = useState(false);
  const [profileDirty, setProfileDirty] = useState(false);
  const [savedFlash, setSavedFlash] = useState(false);

  useEffect(() => {
    if (!data) {
      return;
    }
    if (routeAgentId && data.agents.some((x) => x.id === routeAgentId)) {
      setSelectedId(routeAgentId);
      return;
    }
    setSelectedId((prev) => {
      if (prev && data.agents.some((x) => x.id === prev)) {
        return prev;
      }
      return data.defaultId;
    });
  }, [data, routeAgentId]);

  useEffect(() => {
    if (!data || loading) {
      return;
    }
    const onlyMain =
      data.agents.length <= 1 && data.agents.every((ag) => ag.id === data.defaultId);
    const skipped = localStorage.getItem(PRESET_AGENTS_SKIPPED_KEY) === 'true';
    setShowPresetSetup(onlyMain && !skipped);
  }, [data, loading]);

  const onPresetSetupComplete = useCallback(() => {
    setShowPresetSetup(false);
    void mutateAgents();
  }, [mutateAgents]);

  const onPresetSetupSkip = useCallback(() => {
    setShowPresetSetup(false);
  }, []);

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
    navigate('/settings/agent-defaults?tab=chat', {
      replace: true,
      state: { [SETTINGS_BACK_PATH_STATE_KEY]: AGENTS_APP_LIST_PATH },
    });
  }, [searchParams, navigate]);

  useEffect(() => {
    if (searchParams.get('focus') !== 'avatar' || !routeAgentId) {
      return;
    }
    setPanel('overview');
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

  const cron = useAgentsCronJobs({
    panel,
    hasToken,
    data,
    selected,
    saveErrorMessage: a.saveError,
    setBusy,
    setError,
  });

  const skillsCatalog = useAgentsSkillsCatalog({ panel, hasToken });

  useEffect(() => {
    if (!selected) {
      setEditWorkspace('');
      setEditModel('');
      setEditName('');
      setEditDescription('');
      return;
    }
    setEditWorkspace(selected.workspace);
    setEditModel(selected.model?.primary ?? '');
    setEditName(agentListDisplayName(selected, messages(language).agentsSettings));
    setEditDescription(selected.description?.trim() ?? '');
  }, [selected?.id, language]);

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
    setAddAgentModalOpen(true);
  }, []);

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
      main: null,
      end: agentsHeaderEnd,
    });
    return () => clearPageHeader();
  }, [agentsHeaderEnd, clearPageHeader, hasToken, setPageHeader]);

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
      const desc = createDescription.trim();
      const next = await createGatewayAgent({
        name,
        workspace,
        ...(createAgentId.trim() ? { id: createAgentId.trim() } : {}),
        ...(createModel.trim() ? { model: createModel.trim() } : {}),
        ...(desc ? { description: desc } : {}),
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

  async function onSaveAgentEdits() {
    if (!selected) {
      return;
    }
    setBusy(true);
    setError(null);
    try {
      const descTrim = editDescription.trim();
      const next = await updateGatewayAgent(selected.id, {
        name: editName.trim() || undefined,
        description: descTrim.length > 0 ? descTrim : null,
        workspace: editWorkspace.trim() || undefined,
        model: editModel.trim() || null,
      });
      void mutateAgents(next, { revalidate: false });
    } catch (err) {
      setError(err instanceof Error ? err.message : a.saveError);
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
      const toolsDisable = [...toolsSkills.toolEntryDisable].sort((x, y) => x.localeCompare(y));
      const next = await updateGatewayAgent(selected.id, { toolsDisable });
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
      const next = await updateGatewayAgent(selected.id, { toolsDisable: null });
      void mutateAgents(next, { revalidate: false });
      toolsSkills.setToolEntryDisable(new Set());
    } catch (err) {
      setError(err instanceof Error ? err.message : a.saveError);
    } finally {
      setBusy(false);
    }
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
          : [...toolsSkills.skillsPick].sort((x, y) => x.localeCompare(y)),
      });
      void mutateAgents(next, { revalidate: false });
    } catch (err) {
      setError(err instanceof Error ? err.message : a.saveError);
    } finally {
      setBusy(false);
    }
  }

  const footerSaveNotApplicable = panel === 'channels' || panel === 'cron';

  const overviewRestDirty = (() => {
    if (!selected || panel !== 'overview') return false;
    const origName = agentListDisplayName(selected, a);
    const origDesc = selected.description?.trim() ?? '';
    const origWorkspace = selected.workspace;
    const origModel = selected.model?.primary ?? '';
    return (
      editName.trim() !== origName ||
      editDescription.trim() !== origDesc ||
      editWorkspace.trim() !== origWorkspace ||
      editModel.trim() !== origModel
    );
  })();

  const isCurrentPanelDirty = (() => {
    if (footerSaveNotApplicable) return false;
    switch (panel) {
      case 'overview':
        return overviewRestDirty || overviewProfileMarkdownDirty;
      case 'profile':
        return profileDirty;
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
      case 'overview':
        await Promise.all([
          onSaveAgentEdits(),
          profileFiles.overviewSaveProfileMarkdownRef.current?.() ?? Promise.resolve(),
        ]);
        showSavedFlash();
        break;
      case 'profile':
        await profileSaveRef.current?.();
        showSavedFlash();
        break;
      case 'tools':
        await onSaveTools();
        showSavedFlash();
        break;
      case 'skills':
        await onSaveSkills();
        showSavedFlash();
        break;
      case 'files':
        profileFiles.saveProfileMarkdownDebounced.flush();
        showSavedFlash();
        break;
      default:
        break;
    }
  }

  function onAgentModalOpenChange(open: boolean) {
    if (!open) {
      navigate(AGENTS_APP_LIST_PATH);
    }
  }

  const modalTitle = selected ? editName.trim() || agentListDisplayName(selected, a) : (routeAgentId ?? '');
  const modalSubtitle = selected?.id ?? routeAgentId ?? '';

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
    setEditModel,
    defaultModel: globalAgentDefaults.model,
    defaultWorkspace: globalAgentDefaults.workspace,
    onSetDefault: () => {
      if (!selected) return;
      void onSetDefault(selected);
    },
    onSaveAgentEdits: () => void onSaveAgentEdits(),
    onDelete: (purge: boolean) => {
      if (!selected) return;
      void onDelete(selected, purge);
    },
    overviewSaveProfileMarkdownRef: profileFiles.overviewSaveProfileMarkdownRef,
    profileSaveRef,
    setOverviewProfileMarkdownDirty,
    setProfileDirty,
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
    cronLoading: cron.cronLoading,
    agentCronJobs: cron.agentCronJobs,
    onSetCronJobAgent: (job, key) => void cron.onSetCronJobAgent(job, key),
  };

  return {
    hasToken,
    a,
    chat,
    language,
    data,
    loading,
    displayError,
    navigate,
    routeAgentId,
    showPresetSetup,
    onPresetSetupComplete,
    onPresetSetupSkip,
    busy,
    listSearchQuery,
    openAddAgentModal,
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
