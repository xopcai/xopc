import * as Dialog from '@radix-ui/react-dialog';
import { Moon, Plus, Search } from 'lucide-react';
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
import { useDebouncedCallback } from 'use-debounce';

import { Button } from '@/components/ui/button';
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
import { SETTINGS_BACK_PATH_STATE_KEY } from '@/features/settings/settings-nav-state';
import { suggestWorkspaceFromAgentName } from '@/features/settings/suggest-agent-workspace';
import { postDreamingRunNow, type DreamingPhaseId } from '@/features/settings/dreaming-api';
import { validateAgentIdForNewAgent } from '@/lib/agent-id';
import {
  getChannels,
  getSessionChatIds,
  listJobs,
  updateJob,
  type ChannelStatus,
  type CronJob,
  type SessionChatId,
} from '@/features/cron/cron-api';
import { messages } from '@/i18n/messages';
import { cn } from '@/lib/cn';
import { useGatewayStore } from '@/stores/gateway-store';
import { useLocaleStore } from '@/stores/locale-store';
import { usePageHeaderStore } from '@/stores/page-header-store';

import { agentListDisplayName } from './agent-display-names';
import { AgentsEditorModal } from './agents-editor-modal';
import { AgentsListGrid } from './agents-list-grid';
import { AgentsSettingsHeader } from './agents-settings-header';
import { CreateAgentDialog } from './create-agent-dialog';
import { PRESET_AGENTS_SKIPPED_KEY } from './preset-agents';
import { PresetAgentsSetup } from './preset-agents-setup';
import { AgentChannelsTab } from './tabs/agent-channels-tab';
import { AgentCronTab } from './tabs/agent-cron-tab';
import { AgentFilesTab } from './tabs/agent-files-tab';
import { AgentOverviewTab } from './tabs/agent-overview-tab';
import { AgentProfileTab } from './tabs/agent-profile-tab';
import { AgentSkillsTab } from './tabs/agent-skills-tab';
import { AgentToolsTab } from './tabs/agent-tools-tab';
import type { AgentPanel } from './utils';
import { buildNewBindingMatch, jobMatchesAgent } from './utils';

export function AgentsSettingsPanel() {
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
  const [sleeping, setSleeping] = useState(false);
  const [listSearchQuery, setListSearchQuery] = useState('');

  const [editWorkspace, setEditWorkspace] = useState('');
  const [editModel, setEditModel] = useState('');
  const [editName, setEditName] = useState('');
  const [editDescription, setEditDescription] = useState('');

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
  const overviewSaveBootstrapRef = useRef<(() => Promise<void>) | null>(null);
  const profileSaveRef = useRef<(() => Promise<void>) | null>(null);
  const [overviewBootstrapDirty, setOverviewBootstrapDirty] = useState(false);
  const [profileDirty, setProfileDirty] = useState(false);
  const [savedFlash, setSavedFlash] = useState(false);
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
  const [bindChannelStatuses, setBindChannelStatuses] = useState<ChannelStatus[]>([]);
  const [bindChannelsLoading, setBindChannelsLoading] = useState(false);
  const [bindSessionChats, setBindSessionChats] = useState<SessionChatId[]>([]);
  const [bindSessionsLoading, setBindSessionsLoading] = useState(false);
  const [newBindSessionIdx, setNewBindSessionIdx] = useState<number | null>(null);
  const [newBindCustomPeer, setNewBindCustomPeer] = useState('');

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
    navigate('/settings/agent-defaults', {
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
      setEditDescription('');
      return;
    }
    setEditWorkspace(selected.workspace);
    setEditModel(selected.model?.primary ?? '');
    setEditName(agentListDisplayName(selected, messages(language).agentsSettings));
    setEditDescription(selected.description?.trim() ?? '');
    // Intentionally only `selected?.id` + `language`: refresh localized default main name on locale change
    // without resetting on unrelated `selected` object identity updates from SWR.
  }, [selected?.id, language]);

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

  useEffect(() => {
    if (panel !== 'channels' || !hasToken) {
      return;
    }
    let cancelled = false;
    setBindChannelsLoading(true);
    void getChannels()
      .then((list) => {
        if (!cancelled) {
          setBindChannelStatuses(list);
        }
      })
      .catch(() => {
        if (!cancelled) {
          setBindChannelStatuses([]);
        }
      })
      .finally(() => {
        if (!cancelled) {
          setBindChannelsLoading(false);
        }
      });
    return () => {
      cancelled = true;
    };
  }, [panel, hasToken]);

  useEffect(() => {
    if (bindChannelsLoading || panel !== 'channels' || bindChannelStatuses.length === 0) {
      return;
    }
    setNewBindChannel((prev) => {
      const valid = Boolean(prev) && bindChannelStatuses.some((c) => c.name === prev);
      if (valid) {
        return prev;
      }
      return bindChannelStatuses[0].name;
    });
  }, [bindChannelsLoading, panel, bindChannelStatuses]);

  useEffect(() => {
    if (panel !== 'channels' || !hasToken) {
      return;
    }
    const ch = newBindChannel.trim();
    if (!ch) {
      setBindSessionChats([]);
      return;
    }
    let cancelled = false;
    setNewBindSessionIdx(null);
    setBindSessionsLoading(true);
    void getSessionChatIds(ch)
      .then((ids) => {
        if (!cancelled) {
          setBindSessionChats(ids);
        }
      })
      .catch(() => {
        if (!cancelled) {
          setBindSessionChats([]);
        }
      })
      .finally(() => {
        if (!cancelled) {
          setBindSessionsLoading(false);
        }
      });
    return () => {
      cancelled = true;
    };
  }, [panel, hasToken, newBindChannel]);

  const refreshBindSessions = useCallback(() => {
    const ch = newBindChannel.trim();
    if (!ch) {
      return;
    }
    setBindSessionsLoading(true);
    void getSessionChatIds(ch)
      .then((ids) => {
        setBindSessionChats(ids);
        setNewBindSessionIdx((i) => (i != null && i < ids.length ? i : null));
      })
      .catch(() => {
        setBindSessionChats([]);
        setNewBindSessionIdx(null);
      })
      .finally(() => {
        setBindSessionsLoading(false);
      });
  }, [newBindChannel]);

  const useManualChannel = !bindChannelsLoading && bindChannelStatuses.length === 0;

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

  const sleep = useCallback((ms: number) => new Promise<void>((resolve) => window.setTimeout(resolve, ms)), []);

  const triggerSleepSequence = useCallback(async () => {
    if (sleeping || busy) return;
    setSleeping(true);
    setError(null);

    const phases: DreamingPhaseId[] = ['light', 'deep', 'rem'];
    try {
      // Kick off backend jobs in the background. UI animation should NOT wait on network.
      // We intentionally decouple the visuals from `/api/dreaming/run` latency.
      void (async () => {
        for (const phase of phases) {
          try {
            await postDreamingRunNow(phase);
          } catch {
            // Don't surface here — avoid interrupting animation.
            // If needed, we can add a toast later.
          }
        }
      })();

      for (let idx = 0; idx < phases.length; idx++) {
        const phase = phases[idx];
        // Start animation immediately (SSE may arrive later / job may run long).
        window.dispatchEvent(new CustomEvent('dreaming-phase-start', { detail: { phase, source: 'ui' } }));

        // UI choreography: keep it calm and predictable (meditation / chill).
        // We intentionally do NOT wait for the backend job to finish (end event can be delayed),
        // otherwise the button can get stuck in "Sleeping…" and later phases never play.
        const displayMs = phase === 'light' ? 7000 : phase === 'deep' ? 9000 : 8000;
        await sleep(displayMs);

        // Only end the overlay once, after the final phase, to avoid visible "gaps"
        // between scenes (fade-out would temporarily clear the canvas).
        if (idx === phases.length - 1) {
          // Prevent late SSE `dreaming.phase.start` from re-opening the overlay after we end.
          // (The backend jobs may still be running / dispatching events.)
          (window as unknown as { __xopcDreamingIgnoreSseUntil?: number }).__xopcDreamingIgnoreSseUntil =
            Date.now() + 60_000;
          window.dispatchEvent(new CustomEvent('dreaming-phase-end', { detail: { phase, source: 'ui' } }));
        }
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : a.saveError);
    } finally {
      setSleeping(false);
    }
  }, [a.saveError, busy, sleeping, sleep]);

  const agentsHeaderEnd = useMemo(
    () => (
      <div className="flex min-w-0 flex-1 flex-wrap items-center justify-end gap-2">
        <Button
          type="button"
          variant="secondary"
          className="shrink-0 gap-2"
          disabled={busy || sleeping}
          onClick={() => void triggerSleepSequence()}
          aria-label={language === 'zh' ? '让智能体进入睡眠流程' : 'Trigger agent sleep sequence'}
          title={language === 'zh' ? '由浅入深：Light → Deep → REM' : 'Light → Deep → REM'}
        >
          <Moon className="size-4 shrink-0" strokeWidth={1.75} aria-hidden />
          {language === 'zh' ? (sleeping ? '睡眠中…' : '睡眠') : sleeping ? 'Sleeping…' : 'Sleep'}
        </Button>
        <label className="relative flex min-h-9 min-w-0 max-w-sm cursor-text items-center rounded-pill border border-edge bg-surface-base py-1.5 pl-9 pr-3 shadow-surface dark:bg-surface-hover/40 sm:max-w-md">
          <Search
            className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-fg-disabled"
            strokeWidth={1.75}
            aria-hidden
          />
          <input
            type="search"
            role="searchbox"
            enterKeyHint="search"
            value={listSearchQuery}
            onChange={(e) => setListSearchQuery(e.target.value)}
            placeholder={a.listSearchPlaceholder}
            autoComplete="off"
            spellCheck={false}
            aria-label={a.listSearchPlaceholder}
            className="min-w-0 flex-1 appearance-none border-0 bg-transparent py-0.5 text-sm leading-normal text-fg caret-current placeholder:text-fg-disabled focus:border-0 focus:shadow-none focus:outline-none focus:ring-0 focus-visible:outline-none"
          />
        </label>
        <Button
          type="button"
          variant="primary"
          className="shrink-0 gap-2"
          aria-label={a.addAgentAria}
          disabled={busy}
          onClick={() => openAddAgentModal()}
        >
          <Plus className="size-4" strokeWidth={1.75} aria-hidden />
          {a.addAgent}
        </Button>
      </div>
    ),
    [
      a.addAgent,
      a.addAgentAria,
      a.listSearchPlaceholder,
      busy,
      listSearchQuery,
      openAddAgentModal,
      sleeping,
      triggerSleepSequence,
      language,
    ],
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
    const match = buildNewBindingMatch(
      newBindChannel,
      newBindCustomPeer,
      newBindSessionIdx,
      bindSessionChats,
    );
    const nextList = [
      ...allBindings,
      {
        agentId: selected.id,
        priority: 100,
        enabled: true,
        match,
      },
    ];
    setBusy(true);
    setError(null);
    try {
      await patchGatewayBindings(nextList);
      setAllBindings(nextList);
      setNewBindSessionIdx(null);
      setNewBindCustomPeer('');
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

  const footerSaveNotApplicable = panel === 'channels' || panel === 'cron';

  // Compute whether overview REST fields have changed compared to the loaded agent
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
        return overviewRestDirty || overviewBootstrapDirty;
      case 'profile':
        return profileDirty;
      default:
        return true; // tools, skills, files — always allow save
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
        await Promise.all([onSaveAgentEdits(), overviewSaveBootstrapRef.current?.() ?? Promise.resolve()]);
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
        saveBootstrapDebounced.flush();
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

  if (!hasToken) {
    return (
      <div className="mx-auto flex w-full max-w-app-main flex-col gap-3 px-4 py-8">
        <h1 className="text-lg font-semibold text-fg">{a.title}</h1>
        <p className="text-sm text-fg-muted">{a.needToken}</p>
      </div>
    );
  }

  if (showPresetSetup && data) {
    const existingIds = new Set(data.agents.map((ag) => ag.id));
    return (
      <div className="mx-auto flex w-full max-w-app-main flex-col px-4 py-8">
        <PresetAgentsSetup
          existingAgentIds={existingIds}
          onComplete={onPresetSetupComplete}
          onSkip={onPresetSetupSkip}
        />
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
        editDescription={editDescription}
        setEditDescription={setEditDescription}
        editWorkspace={editWorkspace}
        setEditWorkspace={setEditWorkspace}
        editModel={editModel}
        setEditModel={setEditModel}
        onSetDefault={() => void onSetDefault(selected)}
        onSaveAgentEdits={() => void onSaveAgentEdits()}
        onDelete={(purge) => void onDelete(selected, purge)}
        hideInlineSave
        saveBootstrapRef={overviewSaveBootstrapRef}
        onBootstrapDirtyChange={setOverviewBootstrapDirty}
      />
    ) : panel === 'profile' ? (
      <AgentProfileTab a={a} agentId={selected.id} saveRef={profileSaveRef} onDirtyChange={setProfileDirty} />
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
        channelStatuses={bindChannelStatuses}
        channelsStatusLoading={bindChannelsLoading}
        useManualChannel={useManualChannel}
        newBindChannel={newBindChannel}
        setNewBindChannel={setNewBindChannel}
        bindSessionChats={bindSessionChats}
        sessionsLoading={bindSessionsLoading}
        newBindSessionIdx={newBindSessionIdx}
        setNewBindSessionIdx={setNewBindSessionIdx}
        newBindCustomPeer={newBindCustomPeer}
        setNewBindCustomPeer={setNewBindCustomPeer}
        onRefreshSessions={refreshBindSessions}
        lastActiveLabels={cCron.lastActiveLabels}
        selectRecipient={cCron.selectRecipient}
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
      <AgentsSettingsHeader a={a} />

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
          onFooterSave={() => void handleModalFooterSave()}
          footerSaveDisabled={footerSaveDisabled}
          footerSavedFlash={savedFlash}
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
            setCreateDisplayName('');
            setCreateAgentId('');
            setCreateDescription('');
            setCreateWorkspace('');
            setCreateModel('');
            setCreateModalError(null);
          }
        }}
        a={a}
        chat={chat}
        busy={busy}
        modalError={createModalError}
        createDisplayName={createDisplayName}
        setCreateDisplayName={setCreateDisplayName}
        createAgentId={createAgentId}
        setCreateAgentId={setCreateAgentId}
        createDescription={createDescription}
        setCreateDescription={setCreateDescription}
        createWorkspace={createWorkspace}
        setCreateWorkspace={setCreateWorkspace}
        createModel={createModel}
        setCreateModel={setCreateModel}
        onCreate={onCreate}
        onSuggestWorkspace={() => applyCreateWorkspaceSuggestion()}
      />

      <Dialog.Root
        open={deleteDialogOpen}
        onOpenChange={(open) => {
          setDeleteDialogOpen(open);
          if (!open) {
            setDeleteTarget(null);
            setDeleteConfirmText('');
          }
        }}
      >
        <Dialog.Portal>
          <Dialog.Overlay className="fixed inset-0 z-[80] bg-scrim backdrop-blur-[2px]" />
          <Dialog.Content
            className={cn(
              'fixed left-1/2 top-1/2 z-[81] w-[min(100%-2rem,28rem)] -translate-x-1/2 -translate-y-1/2 rounded-xl border border-edge bg-surface-panel p-4 shadow-popover',
              'dark:border-edge',
            )}
            onOpenAutoFocus={(e) => e.preventDefault()}
          >
            <Dialog.Title className="text-base font-semibold text-fg">
              {deletePurge ? a.purgeDisk : a.removeFromConfig}
            </Dialog.Title>
            <Dialog.Description className="mt-2 whitespace-pre-wrap text-sm leading-relaxed text-fg-muted">
              {deletePurge ? a.confirmDeletePurge : a.confirmDelete}
            </Dialog.Description>

            {deletePurge && deleteTarget ? (
              <div className="mt-3 space-y-3">
                <label className="mb-2 block text-sm font-medium text-fg" htmlFor="agent-delete-confirm">
                  {a.purgeConfirmLabel}
                </label>
                <input
                  id="agent-delete-confirm"
                  type="text"
                  autoComplete="off"
                  spellCheck={false}
                  className={cn(
                    'w-full rounded-md border border-edge bg-surface-panel px-3 py-1.5 font-mono text-xs text-fg',
                    'placeholder:text-fg-subtle',
                    'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent focus-visible:ring-offset-2 focus-visible:ring-offset-surface-panel',
                    'dark:border-edge',
                  )}
                  placeholder={a.purgeConfirmPlaceholder.replace('{{agentId}}', deleteTarget.id)}
                  value={deleteConfirmText}
                  onChange={(e) => setDeleteConfirmText(e.target.value)}
                />
                <p className="pt-0.5 text-xs text-fg-muted">
                  {a.purgeConfirmHint.replace('{{agentId}}', deleteTarget.id)}
                </p>
              </div>
            ) : null}

            <div className="mt-4 flex flex-wrap items-center justify-end gap-2 border-t border-edge-subtle/60 pt-3">
              <Button
                type="button"
                variant="ghost"
                disabled={busy}
                onClick={() => setDeleteDialogOpen(false)}
              >
                {a.createModalCancel}
              </Button>
              <Button
                type="button"
                variant="secondary"
                className={deletePurge ? 'border-red-200 text-red-700 hover:bg-red-50 dark:border-red-900/60 dark:text-red-300 dark:hover:bg-red-950/40' : undefined}
                disabled={
                  busy ||
                  !deleteTarget ||
                  (deletePurge && deleteConfirmText.trim().toLowerCase() !== deleteTarget.id.toLowerCase())
                }
                onClick={() => {
                  if (!deleteTarget) return;
                  void performDelete(deleteTarget, deletePurge);
                }}
              >
                {deletePurge ? a.purgeDisk : a.removeFromConfig}
              </Button>
            </div>
          </Dialog.Content>
        </Dialog.Portal>
      </Dialog.Root>
    </div>
  );
}
