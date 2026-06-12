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
  type LocalizedText,
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
import {
  languageDisplayName,
  languageToLocaleKey,
  localizedTextEquals,
  localizedTextForLanguage,
  localizedTextToMap,
} from './localized-text';
import { useAgentOverviewProfileMarkdown } from './hooks/use-agent-overview-profile-markdown';
import { useAgentProfileFiles } from './hooks/use-agent-profile-files';
import { useAgentsChannelBindings } from './hooks/use-agents-channel-bindings';
import { useAgentsCronJobs } from './hooks/use-agents-cron-jobs';
import { useAgentsSkillsCatalog } from './hooks/use-agents-skills-catalog';
import { useAgentsToolsSkillsLocalState } from './hooks/use-agents-tools-skills-local-state';
import { WEBCHAT_AGENT_STORAGE_KEY } from '@/features/chat/session/chat-session-defaults';

import { PRESET_AGENTS_SKIPPED_KEY } from './preset-agents';
import type { AgentPanel } from './utils';

function buildLocalizedTextForSave(
  base: LocalizedText | undefined,
  language: 'en' | 'zh',
  currentValue: string,
  zhValue: string,
  enValue: string,
): LocalizedText | undefined {
  const localeKey = languageToLocaleKey(language);
  const nextMap = localizedTextToMap(base);
  const currentText = currentValue.trim();
  const zhText = zhValue.trim();
  const enText = enValue.trim();

  if (zhText) {
    nextMap.zh = zhText;
  } else if (localeKey !== 'zh') {
    delete nextMap.zh;
  }

  if (enText) {
    nextMap.en = enText;
  } else if (localeKey !== 'en') {
    delete nextMap.en;
  }

  if (currentText) {
    nextMap[localeKey] = currentText;
  } else {
    delete nextMap[localeKey];
  }

  const entries = Object.entries(nextMap).filter(([, text]) => text.trim().length > 0);
  if (entries.length === 0) {
    return undefined;
  }
  if (entries.length === 1 && entries[0]?.[0] === 'en') {
    return entries[0][1].trim();
  }
  return Object.fromEntries(entries.map(([locale, text]) => [locale, text.trim()]));
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
  const [presetSetupDismissed, setPresetSetupDismissed] = useState(
    () => localStorage.getItem(PRESET_AGENTS_SKIPPED_KEY) === 'true',
  );
  const [panel, setPanel] = useState<AgentPanel>('overview');

  const [createDisplayName, setCreateDisplayName] = useState('');
  const [createNameZh, setCreateNameZh] = useState('');
  const [createNameEn, setCreateNameEn] = useState('');
  const [createLocalizedOpen, setCreateLocalizedOpen] = useState(false);
  const [createAgentId, setCreateAgentId] = useState('');
  const [createDescription, setCreateDescription] = useState('');
  const [createDescriptionZh, setCreateDescriptionZh] = useState('');
  const [createDescriptionEn, setCreateDescriptionEn] = useState('');
  const [createWorkspace, setCreateWorkspace] = useState('');
  const [createModel, setCreateModel] = useState('');
  const [createModalError, setCreateModalError] = useState<string | null>(null);
  const [addAgentModalOpen, setAddAgentModalOpen] = useState(false);
  const createWorkspaceSuggestedRef = useRef('');
  const [duplicateSourceId, setDuplicateSourceId] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [listSearchQuery, setListSearchQuery] = useState('');

  const [editWorkspace, setEditWorkspace] = useState('');
  const [editModel, setEditModel] = useState('');
  const [editName, setEditName] = useState('');
  const [editNameZh, setEditNameZh] = useState('');
  const [editNameEn, setEditNameEn] = useState('');
  const [editLocalizedOpen, setEditLocalizedOpen] = useState(false);
  const [editDescription, setEditDescription] = useState('');
  const [editDescriptionZh, setEditDescriptionZh] = useState('');
  const [editDescriptionEn, setEditDescriptionEn] = useState('');

  const profileSaveRef = useRef<(() => Promise<void>) | null>(null);
  const overviewSaveProfileMarkdownRef = useRef<(() => Promise<void>) | null>(null);
  const [profileDirty, setProfileDirty] = useState(false);
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

  const onlyMainAgent =
    data != null &&
    data.agents.length <= 1 &&
    data.agents.every((ag) => ag.id === data.defaultId);
  const showPresetSetup = Boolean(data && !loading && onlyMainAgent && !presetSetupDismissed);

  const onPresetSetupComplete = useCallback(() => {
    setPresetSetupDismissed(true);
    void mutateAgents();
  }, [mutateAgents]);

  const onPresetSetupSkip = useCallback(() => {
    localStorage.setItem(PRESET_AGENTS_SKIPPED_KEY, 'true');
    setPresetSetupDismissed(true);
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
    navigate('/settings/agent-defaults', {
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

  const trackedSelectedIdRef = useRef<string | null>(null);
  const selectedTrackingKey = selected ? `${selected.id}:${language}` : null;
  if (selected && trackedSelectedIdRef.current !== selectedTrackingKey) {
    trackedSelectedIdRef.current = selectedTrackingKey;
    setEditWorkspace(selected.workspace);
    setEditModel(selected.model?.primary ?? '');
    const selectedNameValue = selected.localized?.name ?? selected.name;
    const selectedDescriptionValue = selected.localized?.description ?? selected.description;
    const selectedNameMap = localizedTextToMap(selectedNameValue);
    const selectedDescriptionMap = localizedTextToMap(selectedDescriptionValue);
    const currentName =
      localizedTextForLanguage(selectedNameValue, language) ??
      agentListDisplayName(selected, messages(language).agentsSettings);
    const currentDescription = localizedTextForLanguage(selectedDescriptionValue, language) ?? '';
    setEditName(currentName);
    setEditNameZh(selectedNameMap.zh ?? (language === 'zh' ? currentName : ''));
    setEditNameEn(selectedNameMap.en ?? (language === 'en' ? currentName : ''));
    setEditDescription(currentDescription);
    setEditDescriptionZh(selectedDescriptionMap.zh ?? (language === 'zh' ? currentDescription : ''));
    setEditDescriptionEn(selectedDescriptionMap.en ?? (language === 'en' ? currentDescription : ''));
  } else if (!selected && trackedSelectedIdRef.current !== null) {
    trackedSelectedIdRef.current = null;
    setEditWorkspace('');
    setEditModel('');
    setEditName('');
    setEditNameZh('');
    setEditNameEn('');
    setEditDescription('');
    setEditDescriptionZh('');
    setEditDescriptionEn('');
  }

  const overviewProfile = useAgentOverviewProfileMarkdown({
    agentId: selected?.id ?? null,
    enabled: panel === 'overview' && Boolean(selected),
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
    setCreateNameZh('');
    setCreateNameEn('');
    setCreateAgentId('');
    setCreateDescription('');
    setCreateDescriptionZh('');
    setCreateDescriptionEn('');
    setCreateWorkspace('');
    setCreateModel('');
    setCreateModalError(null);
    setDuplicateSourceId(null);
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
        return;
      }

      const source = data?.agents.find((ag) => ag.id === sourceId);
      if (!source) return;
      const sourceName =
        localizedTextForLanguage(source.localized?.name ?? source.name, language) ?? source.name?.trim() ?? source.id;
      const duplicateName = a.duplicateName.replace('{{name}}', sourceName);
      const duplicateId = makeAvailableAgentId(source.id);
      const sourceNameMap = localizedTextToMap(source.localized?.name ?? source.name);
      const sourceDescriptionMap = localizedTextToMap(source.localized?.description ?? source.description);
      const sourceDescription =
        localizedTextForLanguage(source.localized?.description ?? source.description, language) ?? '';
      createWorkspaceSuggestedRef.current = '';
      setCreateDisplayName(duplicateName);
      setCreateNameZh(sourceNameMap.zh ?? (language === 'zh' ? duplicateName : ''));
      setCreateNameEn(sourceNameMap.en ?? (language === 'en' ? duplicateName : ''));
      setCreateAgentId(duplicateId);
      setCreateDescription(sourceDescription);
      setCreateDescriptionZh(sourceDescriptionMap.zh ?? (language === 'zh' ? sourceDescription : ''));
      setCreateDescriptionEn(sourceDescriptionMap.en ?? (language === 'en' ? sourceDescription : ''));
      setCreateWorkspace(source.workspace);
      setCreateModel(source.model?.primary ?? '');
      setCreateModalError(null);
    },
    [a.duplicateName, data, language, makeAvailableAgentId],
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
      const nextName = buildLocalizedTextForSave(undefined, language, name, createNameZh, createNameEn) ?? name;
      const nextDescription = buildLocalizedTextForSave(
        undefined,
        language,
        createDescription,
        createDescriptionZh,
        createDescriptionEn,
      );
      const next = await createGatewayAgent({
        name: nextName,
        workspace,
        ...(createAgentId.trim() ? { id: createAgentId.trim() } : {}),
        ...(createModel.trim() ? { model: createModel.trim() } : {}),
        ...(nextDescription ? { description: nextDescription } : {}),
        ...(duplicateSourceId ? { cloneFrom: duplicateSourceId } : {}),
      });
      const { createdAgentId, ...agentsPayload } = next;
      void mutateAgents(agentsPayload, { revalidate: false });
      setCreateDisplayName('');
      setCreateNameZh('');
      setCreateNameEn('');
      setCreateAgentId('');
      setCreateDescription('');
      setCreateDescriptionZh('');
      setCreateDescriptionEn('');
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
      const nextName = buildLocalizedTextForSave(
        selected.localized?.name ?? selected.name,
        language,
        editName,
        editNameZh,
        editNameEn,
      );
      const nextDescription = buildLocalizedTextForSave(
        selected.localized?.description ?? selected.description,
        language,
        editDescription,
        editDescriptionZh,
        editDescriptionEn,
      );
      const next = await updateGatewayAgent(selected.id, {
        ...(nextName ? { name: nextName } : {}),
        description: nextDescription ?? null,
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
      const toolsDisable = Array.from(toolsSkills.toolEntryDisable).toSorted((x, y) => x.localeCompare(y));
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
          : [...toolsSkills.skillsPick].toSorted((x, y) => x.localeCompare(y)),
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
    const origName =
      localizedTextForLanguage(selected.localized?.name ?? selected.name, language) ??
      agentListDisplayName(selected, a);
    const origDesc =
      localizedTextForLanguage(selected.localized?.description ?? selected.description, language) ?? '';
    const nextName = buildLocalizedTextForSave(
      selected.localized?.name ?? selected.name,
      language,
      editName,
      editNameZh,
      editNameEn,
    );
    const nextDescription = buildLocalizedTextForSave(
      selected.localized?.description ?? selected.description,
      language,
      editDescription,
      editDescriptionZh,
      editDescriptionEn,
    );
    const origWorkspace = selected.workspace;
    const origModel = selected.model?.primary ?? '';
    return (
      editName.trim() !== origName ||
      editDescription.trim() !== origDesc ||
      !localizedTextEquals(nextName, selected.localized?.name ?? selected.name) ||
      !localizedTextEquals(nextDescription, selected.localized?.description ?? selected.description) ||
      editWorkspace.trim() !== origWorkspace ||
      editModel.trim() !== origModel
    );
  })();

  const isCurrentPanelDirty = (() => {
    if (footerSaveNotApplicable) return false;
    if (!selected) return false;
    switch (panel) {
      case 'overview':
        return overviewRestDirty || overviewProfile.dirty;
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
          overviewSaveProfileMarkdownRef.current?.() ?? Promise.resolve(),
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

  const handleTryInChat = useCallback(async () => {
    if (!selected) return;
    // Save current panel state before navigating
    await handleModalFooterSave();
    // Set agent in localStorage and navigate to a new chat
    try {
      globalThis.localStorage?.setItem(WEBCHAT_AGENT_STORAGE_KEY, selected.id);
    } catch {
      /* noop */
    }
    navigate('/chat/new', { state: { agentId: selected.id, fromAgentEditor: true } });
  }, [selected, handleModalFooterSave, navigate]);

  const editorPanelProps: AgentsEditorPanelContentProps = {
    a,
    chat,
    cCron,
    selected,
    panel,
    data,
    busy,
    currentLanguageLabel: languageDisplayName(language),
    editName,
    setEditName,
    editNameZh,
    setEditNameZh,
    editNameEn,
    setEditNameEn,
    editLocalizedOpen,
    setEditLocalizedOpen,
    editDescription,
    setEditDescription,
    editDescriptionZh,
    setEditDescriptionZh,
    editDescriptionEn,
    setEditDescriptionEn,
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
    onTryInChat: () => void handleTryInChat(),
    overviewSaveProfileMarkdownRef,
    profileSaveRef,
    overviewProfile,
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
    localizedLanguageLabel: languageDisplayName(language),
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
    openDuplicateAgentModal,
    duplicateSourceId,
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
    createNameZh,
    setCreateNameZh,
    createNameEn,
    setCreateNameEn,
    createLocalizedOpen,
    setCreateLocalizedOpen,
    createAgentId,
    setCreateAgentId,
    createDescription,
    setCreateDescription,
    createDescriptionZh,
    setCreateDescriptionZh,
    createDescriptionEn,
    setCreateDescriptionEn,
    createWorkspace,
    setCreateWorkspace,
    createModel,
    setCreateModel,
    onCreate,
    currentLanguageLabel: languageDisplayName(language),
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
