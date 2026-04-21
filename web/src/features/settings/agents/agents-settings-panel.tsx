import { useCallback, useEffect, useMemo, useRef, useState, type FormEvent } from 'react';
import { useNavigate, useParams, useSearchParams } from 'react-router-dom';
import useSWR from 'swr';
import { useDebouncedCallback } from 'use-debounce';

import { useGatewayConfigSwr } from '@/features/gateway/gateway-config-swr';
import {
  createGatewayAgent,
  deleteGatewayAgent,
  fetchAgentBootstrapFileContent,
  fetchAgentBootstrapFiles,
  fetchGatewayAgents,
  parseGatewayBindingsFromConfig,
  fetchSkillsCatalog,
  patchGatewayBindings,
  saveAgentBootstrapFileContent,
  updateGatewayAgent,
  type GatewayAgentRow,
  type GatewayAgentsPayload,
  type GatewayConfigBinding,
  type SkillCatalogRow,
} from '@/features/settings/agents-admin-api';
import { AGENTS_APP_LIST_PATH, agentsAppDetailPath } from '@/features/settings/agents/agents-app-path';
import { suggestWorkspaceFromAgentName } from '@/features/settings/suggest-agent-workspace';
import { listJobs, updateJob, type CronJob } from '@/features/cron/cron-api';
import { messages } from '@/i18n/messages';
import { useGatewayStore } from '@/stores/gateway-store';
import { useLocaleStore } from '@/stores/locale-store';

import { AgentsEditorModal } from './agents-editor-modal';
import { AgentsListGrid } from './agents-list-grid';
import { AgentsSettingsHeader } from './agents-settings-header';
import { CreateAgentDialog } from './create-agent-dialog';
import { AgentChannelsTab } from './tabs/agent-channels-tab';
import { AgentCronTab } from './tabs/agent-cron-tab';
import { AgentFilesTab } from './tabs/agent-files-tab';
import { AgentOverviewTab } from './tabs/agent-overview-tab';
import { AgentSkillsTab } from './tabs/agent-skills-tab';
import { AgentToolsTab } from './tabs/agent-tools-tab';
import type { AgentPanel } from './utils';
import { jobMatchesAgent } from './utils';

export function AgentsSettingsPanel() {
  const language = useLocaleStore((s) => s.language);
  const m = messages(language);
  const a = m.agentsSettings;
  const chat = m.chat;
  const token = useGatewayStore((st) => st.token);
  const hasToken = Boolean(token);
  const [searchParams] = useSearchParams();
  const navigate = useNavigate();
  const { agentId: routeAgentId } = useParams<{ agentId?: string }>();

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

  const data: GatewayAgentsPayload | null = swrAgentsData ?? null;
  const loading = Boolean(hasToken && agentsLoading);
  const [error, setError] = useState<string | null>(null);
  const loadError =
    swrAgentsError instanceof Error ? swrAgentsError.message : swrAgentsError ? a.loadError : null;
  const displayError = error ?? loadError;

  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [panel, setPanel] = useState<AgentPanel>('overview');

  const [createName, setCreateName] = useState('');
  const [createWorkspace, setCreateWorkspace] = useState('');
  const [createModel, setCreateModel] = useState('');
  const [addAgentModalOpen, setAddAgentModalOpen] = useState(false);
  const createWorkspaceSuggestedRef = useRef('');
  const [busy, setBusy] = useState(false);
  const [listSearchQuery, setListSearchQuery] = useState('');

  const [editWorkspace, setEditWorkspace] = useState('');
  const [editModel, setEditModel] = useState('');
  const [editName, setEditName] = useState('');

  const [files, setFiles] = useState<Awaited<ReturnType<typeof fetchAgentBootstrapFiles>> | null>(null);
  const [filesLoading, setFilesLoading] = useState(false);
  const [activeFile, setActiveFile] = useState<string | null>(null);
  const [fileDraft, setFileDraft] = useState('');
  const [fileSaving, setFileSaving] = useState(false);
  const [bootstrapViewMode, setBootstrapViewMode] = useState<'edit' | 'preview'>('edit');
  const [bootstrapFileLoading, setBootstrapFileLoading] = useState(false);
  const [bootstrapEditorNonce, setBootstrapEditorNonce] = useState(0);

  const fileDraftRef = useRef(fileDraft);
  fileDraftRef.current = fileDraft;
  const selectedIdRef = useRef(selectedId);
  selectedIdRef.current = selectedId;
  const activeFileRef = useRef(activeFile);
  activeFileRef.current = activeFile;
  const bootstrapFileKeyRef = useRef('');
  const bootstrapSyncedRef = useRef('');

  const saveBootstrapDebounced = useDebouncedCallback(
    async () => {
      const sid = selectedIdRef.current;
      const name = activeFileRef.current;
      if (!sid || !name) {
        return;
      }
      const key = `${sid}:${name}`;
      if (key !== bootstrapFileKeyRef.current) {
        return;
      }
      const draft = fileDraftRef.current;
      if (draft === bootstrapSyncedRef.current) {
        return;
      }
      setFileSaving(true);
      setError(null);
      try {
        await saveAgentBootstrapFileContent(sid, name, draft);
        bootstrapSyncedRef.current = draft;
        setFiles((prev) => {
          if (!prev || prev.agentId !== sid) {
            return prev;
          }
          return {
            ...prev,
            files: prev.files.map((f) => (f.name === name ? { ...f, missing: false } : f)),
          };
        });
      } catch (err) {
        setError(err instanceof Error ? err.message : a.saveError);
      } finally {
        setFileSaving(false);
      }
    },
    800,
  );

  const flushBootstrapSaveRef = useRef(saveBootstrapDebounced.flush);
  flushBootstrapSaveRef.current = saveBootstrapDebounced.flush;

  useEffect(() => {
    return () => {
      flushBootstrapSaveRef.current();
    };
  }, []);

  const [toolEntryDisable, setToolEntryDisable] = useState<Set<string>>(() => new Set());
  const [skillsPick, setSkillsPick] = useState<Set<string>>(() => new Set());
  const [skillsInherit, setSkillsInherit] = useState(true);

  const [allBindings, setAllBindings] = useState<GatewayConfigBinding[]>([]);
  const [newBindChannel, setNewBindChannel] = useState('');
  const [newBindPeerId, setNewBindPeerId] = useState('');

  const [cronJobs, setCronJobs] = useState<CronJob[]>([]);
  const [cronLoading, setCronLoading] = useState(false);

  const [skillCatalog, setSkillCatalog] = useState<SkillCatalogRow[]>([]);
  const [skillsCatalogLoading, setSkillsCatalogLoading] = useState(false);

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
    navigate('/settings/agent-defaults', { replace: true });
  }, [searchParams, navigate]);

  const selected = useMemo(
    () => data?.agents.find((x) => x.id === selectedId) ?? null,
    [data, selectedId],
  );

  const agentBindings = useMemo(() => {
    if (!selected) {
      return [];
    }
    return allBindings.filter((b) => b.agentId.toLowerCase() === selected.id.toLowerCase());
  }, [allBindings, selected?.id]);

  const agentCronJobs = useMemo(() => {
    if (!data || !selected) {
      return [];
    }
    return cronJobs.filter((j) => jobMatchesAgent(j, selected.id, data.defaultId));
  }, [cronJobs, data, selected?.id]);

  const catalogForPick = useMemo(
    () => skillCatalog.filter((s) => s.enabled !== false),
    [skillCatalog],
  );

  useEffect(() => {
    if (!selected) {
      setEditWorkspace('');
      setEditModel('');
      setEditName('');
      return;
    }
    setEditWorkspace(selected.workspace);
    setEditModel(selected.model?.primary ?? '');
    setEditName(selected.name?.trim() ? selected.name.trim() : selected.id);
  }, [selected]);

  useEffect(() => {
    if (panel !== 'files' || !selectedId || !hasToken) {
      return;
    }
    let cancelled = false;
    setFilesLoading(true);
    void fetchAgentBootstrapFiles(selectedId)
      .then((f) => {
        if (!cancelled) {
          setFiles(f);
        }
      })
      .catch(() => {
        if (!cancelled) {
          setFiles(null);
        }
      })
      .finally(() => {
        if (!cancelled) {
          setFilesLoading(false);
        }
      });
    return () => {
      cancelled = true;
    };
  }, [panel, selectedId, hasToken, data?.agents.length]);

  useEffect(() => {
    if (!selected || panel !== 'tools') {
      return;
    }
    setToolEntryDisable(new Set(selected.tools.entryDisable));
  }, [panel, selected]);

  useEffect(() => {
    if (!selected || panel !== 'skills') {
      return;
    }
    const inherit = selected.skills.entry === undefined;
    setSkillsInherit(inherit);
    if (inherit) {
      const eff = selected.skills.effectiveAllowlist;
      setSkillsPick(new Set(eff ?? []));
    } else {
      setSkillsPick(new Set(selected.skills.entry ?? []));
    }
  }, [panel, selected]);

  useEffect(() => {
    if (panel !== 'channels' || !hasToken) {
      return;
    }
    setAllBindings(bindingsFromConfig);
  }, [panel, hasToken, bindingsFromConfig]);

  const bindingsLoading = panel === 'channels' && hasToken && gatewayCfgData === undefined;

  useEffect(() => {
    if (panel !== 'cron' || !hasToken) {
      return;
    }
    let cancelled = false;
    setCronLoading(true);
    void listJobs()
      .then((j) => {
        if (!cancelled) {
          setCronJobs(j);
        }
      })
      .catch(() => {
        if (!cancelled) {
          setCronJobs([]);
        }
      })
      .finally(() => {
        if (!cancelled) {
          setCronLoading(false);
        }
      });
    return () => {
      cancelled = true;
    };
  }, [panel, hasToken]);

  useEffect(() => {
    if (panel !== 'skills' || !hasToken) {
      return;
    }
    let cancelled = false;
    setSkillsCatalogLoading(true);
    void fetchSkillsCatalog()
      .then((rows) => {
        if (!cancelled) {
          setSkillCatalog(rows);
        }
      })
      .catch(() => {
        if (!cancelled) {
          setSkillCatalog([]);
        }
      })
      .finally(() => {
        if (!cancelled) {
          setSkillsCatalogLoading(false);
        }
      });
    return () => {
      cancelled = true;
    };
  }, [panel, hasToken]);

  useEffect(() => {
    if (!activeFile || !selectedId || !hasToken) {
      return;
    }
    let cancelled = false;
    saveBootstrapDebounced.flush();
    setBootstrapFileLoading(true);
    void fetchAgentBootstrapFileContent(selectedId, activeFile)
      .then((c) => {
        if (cancelled) {
          return;
        }
        const key = `${selectedId}:${activeFile}`;
        bootstrapFileKeyRef.current = key;
        bootstrapSyncedRef.current = c;
        setFileDraft(c);
        setBootstrapEditorNonce((n) => n + 1);
      })
      .catch(() => {
        if (!cancelled) {
          const key = `${selectedId}:${activeFile}`;
          bootstrapFileKeyRef.current = key;
          bootstrapSyncedRef.current = '';
          setFileDraft('');
          setBootstrapEditorNonce((n) => n + 1);
        }
      })
      .finally(() => {
        if (!cancelled) {
          setBootstrapFileLoading(false);
        }
      });
    return () => {
      cancelled = true;
    };
  }, [activeFile, selectedId, hasToken, saveBootstrapDebounced]);

  useEffect(() => {
    if (!activeFile || !selectedId || bootstrapFileLoading) {
      return;
    }
    saveBootstrapDebounced();
  }, [fileDraft, activeFile, selectedId, bootstrapFileLoading, saveBootstrapDebounced]);

  useEffect(() => {
    if (panel !== 'files') {
      return;
    }
    return () => {
      saveBootstrapDebounced.flush();
    };
  }, [panel, saveBootstrapDebounced]);

  useEffect(() => {
    setBootstrapViewMode('edit');
  }, [activeFile, selectedId]);

  const applyCreateWorkspaceSuggestion = useCallback(() => {
    const next = suggestWorkspaceFromAgentName(createName);
    setCreateWorkspace((prev) => {
      if (prev === '' || prev === createWorkspaceSuggestedRef.current) {
        createWorkspaceSuggestedRef.current = next;
        return next;
      }
      return prev;
    });
  }, [createName]);

  function openAddAgentModal() {
    createWorkspaceSuggestedRef.current = '';
    setCreateName('');
    setCreateWorkspace('');
    setCreateModel('');
    setAddAgentModalOpen(true);
  }

  async function onCreate(e: FormEvent) {
    e.preventDefault();
    const name = createName.trim();
    if (!name) {
      return;
    }
    const wsInput = createWorkspace.trim();
    const workspace = wsInput || suggestWorkspaceFromAgentName(name);
    if (!workspace) {
      return;
    }
    setBusy(true);
    setError(null);
    try {
      const next = await createGatewayAgent({
        name,
        workspace,
        ...(createModel.trim() ? { model: createModel.trim() } : {}),
      });
      void mutateAgents(next, { revalidate: false });
      setCreateName('');
      setCreateWorkspace('');
      setCreateModel('');
      setAddAgentModalOpen(false);
      const id = next.agents[next.agents.length - 1]?.id;
      if (id) {
        setSelectedId(id);
        navigate(agentsAppDetailPath(id));
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : a.saveError);
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
      const next = await updateGatewayAgent(selected.id, {
        name: editName.trim() || undefined,
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

  async function onDelete(agent: GatewayAgentRow, purge: boolean) {
    if (agent.id === 'main') {
      return;
    }
    if (!window.confirm(purge ? a.confirmDeletePurge : a.confirmDelete)) {
      return;
    }
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
    } catch (err) {
      setError(err instanceof Error ? err.message : a.saveError);
    } finally {
      setBusy(false);
    }
  }

  async function onSaveTools() {
    if (!selected) {
      return;
    }
    setBusy(true);
    setError(null);
    try {
      const toolsDisable = [...toolEntryDisable].sort((x, y) => x.localeCompare(y));
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
      setToolEntryDisable(new Set());
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
        skills: skillsInherit ? null : [...skillsPick].sort((x, y) => x.localeCompare(y)),
      });
      void mutateAgents(next, { revalidate: false });
    } catch (err) {
      setError(err instanceof Error ? err.message : a.saveError);
    } finally {
      setBusy(false);
    }
  }

  async function onRemoveBinding(rule: GatewayConfigBinding) {
    setBusy(true);
    setError(null);
    try {
      const nextList = allBindings.filter((b) => b !== rule);
      await patchGatewayBindings(nextList);
      setAllBindings(nextList);
    } catch (err) {
      setError(err instanceof Error ? err.message : a.saveError);
    } finally {
      setBusy(false);
    }
  }

  async function onAddBinding(e: FormEvent) {
    e.preventDefault();
    if (!selected || !newBindChannel.trim()) {
      return;
    }
    const nextList = [
      ...allBindings,
      {
        agentId: selected.id,
        priority: 100,
        enabled: true,
        match: {
          channel: newBindChannel.trim(),
          ...(newBindPeerId.trim() ? { peerId: newBindPeerId.trim() } : {}),
        },
      },
    ];
    setBusy(true);
    setError(null);
    try {
      await patchGatewayBindings(nextList);
      setAllBindings(nextList);
      setNewBindChannel('');
      setNewBindPeerId('');
    } catch (err) {
      setError(err instanceof Error ? err.message : a.saveError);
    } finally {
      setBusy(false);
    }
  }

  async function onSetCronJobAgent(job: CronJob, agentKey: string) {
    setBusy(true);
    setError(null);
    try {
      await updateJob(job.id, { agentId: agentKey === '' ? null : agentKey });
      setCronJobs(await listJobs());
    } catch (err) {
      setError(err instanceof Error ? err.message : a.saveError);
    } finally {
      setBusy(false);
    }
  }

  const footerSaveDisabled = panel === 'channels' || panel === 'cron';

  function handleModalFooterSave() {
    switch (panel) {
      case 'overview':
        void onSaveAgentEdits();
        break;
      case 'tools':
        void onSaveTools();
        break;
      case 'skills':
        void onSaveSkills();
        break;
      case 'files':
        saveBootstrapDebounced.flush();
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

  const modalTitle = selected
    ? editName.trim() || selected.name?.trim() || selected.id
    : (routeAgentId ?? '');
  const modalSubtitle = selected?.id ?? routeAgentId ?? '';

  if (!hasToken) {
    return (
      <div className="mx-auto flex w-full max-w-app-main flex-col gap-3 px-4 py-8">
        <h1 className="text-lg font-semibold text-fg">{a.title}</h1>
        <p className="text-sm text-fg-muted">{a.needToken}</p>
      </div>
    );
  }

  const editorPanelContent =
    !selected ? (
      <p className="text-sm text-fg-muted">{a.selectAgentHint}</p>
    ) : panel === 'overview' ? (
      <AgentOverviewTab
        a={a}
        chat={chat}
        selected={selected}
        busy={busy}
        editName={editName}
        setEditName={setEditName}
        editWorkspace={editWorkspace}
        setEditWorkspace={setEditWorkspace}
        editModel={editModel}
        setEditModel={setEditModel}
        onSetDefault={() => void onSetDefault(selected)}
        onSaveAgentEdits={() => void onSaveAgentEdits()}
        onDelete={(purge) => void onDelete(selected, purge)}
        hideInlineSave
      />
    ) : panel === 'files' ? (
      <AgentFilesTab
        a={a}
        filesLoading={filesLoading}
        files={files}
        activeFile={activeFile}
        setActiveFile={setActiveFile}
        bootstrapViewMode={bootstrapViewMode}
        setBootstrapViewMode={setBootstrapViewMode}
        fileDraft={fileDraft}
        setFileDraft={setFileDraft}
        fileSaving={fileSaving}
        bootstrapFileLoading={bootstrapFileLoading}
        bootstrapEditorNonce={bootstrapEditorNonce}
      />
    ) : panel === 'tools' ? (
      <AgentToolsTab
        a={a}
        data={data!}
        selected={selected}
        busy={busy}
        toolEntryDisable={toolEntryDisable}
        setToolEntryDisable={setToolEntryDisable}
        onSaveTools={() => void onSaveTools()}
        onClearToolsEntry={() => void onClearToolsEntry()}
        hideInlineSave
      />
    ) : panel === 'skills' ? (
      <AgentSkillsTab
        a={a}
        selected={selected}
        busy={busy}
        skillsCatalogLoading={skillsCatalogLoading}
        catalogForPick={catalogForPick}
        skillsInherit={skillsInherit}
        setSkillsInherit={setSkillsInherit}
        skillsPick={skillsPick}
        setSkillsPick={setSkillsPick}
        onSaveSkills={() => void onSaveSkills()}
        hideInlineSave
      />
    ) : panel === 'channels' ? (
      <AgentChannelsTab
        a={a}
        busy={busy}
        bindingsLoading={bindingsLoading}
        agentBindings={agentBindings}
        newBindChannel={newBindChannel}
        setNewBindChannel={setNewBindChannel}
        newBindPeerId={newBindPeerId}
        setNewBindPeerId={setNewBindPeerId}
        onRemoveBinding={(rule) => void onRemoveBinding(rule)}
        onAddBinding={onAddBinding}
      />
    ) : panel === 'cron' && data ? (
      <AgentCronTab
        a={a}
        data={data}
        selected={selected}
        busy={busy}
        cronLoading={cronLoading}
        agentCronJobs={agentCronJobs}
        onSetCronJobAgent={(job, key) => void onSetCronJobAgent(job, key)}
      />
    ) : (
      <p className="text-sm text-fg-muted">{a.selectAgentHint}</p>
    );

  return (
    <div className="mx-auto flex w-full max-w-app-main flex-col gap-6 px-4 py-8">
      <AgentsSettingsHeader a={a} data={data} loading={loading} busy={busy} onOpenAddAgent={openAddAgentModal} />

      {displayError ? (
        <div className="rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-800 dark:border-red-900/50 dark:bg-red-950/40 dark:text-red-200">
          {displayError}
        </div>
      ) : null}

      {loading ? (
        <p className="text-sm text-fg-muted">{a.loading}</p>
      ) : data ? (
        <AgentsListGrid
          a={a}
          agents={data.agents}
          searchQuery={listSearchQuery}
          onSearchQueryChange={setListSearchQuery}
          onOpenAgent={(id) => navigate(agentsAppDetailPath(id))}
          onChatWithAgent={(id) =>
            navigate('/chat/new', { state: { agentId: id.trim().toLowerCase() } })
          }
          onNewAgent={openAddAgentModal}
          busy={busy}
        />
      ) : null}

      {routeAgentId && hasToken ? (
        <AgentsEditorModal
          open={Boolean(routeAgentId)}
          onOpenChange={onAgentModalOpenChange}
          a={a}
          title={modalTitle}
          subtitle={modalSubtitle}
          panel={panel}
          onPanelChange={setPanel}
          onFooterSave={handleModalFooterSave}
          footerSaveDisabled={footerSaveDisabled}
          busy={busy}
        >
          {loading || !data ? (
            <p className="text-sm text-fg-muted">{a.loading}</p>
          ) : (
            editorPanelContent
          )}
        </AgentsEditorModal>
      ) : null}

      <CreateAgentDialog
        open={addAgentModalOpen}
        onOpenChange={(open) => {
          setAddAgentModalOpen(open);
          if (!open) {
            createWorkspaceSuggestedRef.current = '';
            setCreateName('');
            setCreateWorkspace('');
            setCreateModel('');
          }
        }}
        a={a}
        chat={chat}
        busy={busy}
        createName={createName}
        setCreateName={setCreateName}
        createWorkspace={createWorkspace}
        setCreateWorkspace={setCreateWorkspace}
        createModel={createModel}
        setCreateModel={setCreateModel}
        onCreate={onCreate}
        onNameBlur={() => applyCreateWorkspaceSuggestion()}
      />
    </div>
  );
}
