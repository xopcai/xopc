import * as Dialog from '@radix-ui/react-dialog';
import {
  AlarmClock,
  BookOpen,
  Eye,
  Link2,
  ListTree,
  Plus,
  SquarePen,
  Trash2,
  UserPlus,
  Users,
  Wrench,
  X,
} from 'lucide-react';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import { useDebouncedCallback } from 'use-debounce';

import { MarkdownView } from '@/components/markdown/markdown-view';
import { Button } from '@/components/ui/button';
import { SettingsFormSection, SettingsFormSectionHeader } from '@/features/settings/settings-form-section';
import {
  createGatewayAgent,
  deleteGatewayAgent,
  fetchAgentBootstrapFileContent,
  fetchAgentBootstrapFiles,
  fetchGatewayAgents,
  fetchGatewayConfigBindings,
  fetchSkillsCatalog,
  patchGatewayBindings,
  saveAgentBootstrapFileContent,
  updateGatewayAgent,
  type GatewayAgentRow,
  type GatewayAgentsPayload,
  type GatewayConfigBinding,
  type SkillCatalogRow,
} from '@/features/settings/agents-admin-api';
import { AgentSettingsPanel } from '@/features/settings/agent-settings';
import { suggestWorkspaceFromAgentName } from '@/features/settings/suggest-agent-workspace';
import { ModelSelector } from '@/features/chat/model-selector';
import { cronJobBodyText, listJobs, updateJob, type CronJob } from '@/features/cron/cron-api';
import { settingsInputFocusClass } from '@/lib/form-field-width';
import { cn } from '@/lib/cn';
import { messages } from '@/i18n/messages';
import { useGatewayStore } from '@/stores/gateway-store';
import { useLocaleStore } from '@/stores/locale-store';

function inputClass(): string {
  return cn(
    'w-full rounded-lg border border-edge bg-surface-panel px-3 py-2 text-sm text-fg',
    'placeholder:text-fg-subtle',
    settingsInputFocusClass,
    'dark:border-edge',
  );
}

type AgentPanel = 'overview' | 'defaults' | 'files' | 'tools' | 'skills' | 'channels' | 'cron';

function jobMatchesAgent(job: CronJob, agentId: string, defaultId: string): boolean {
  const raw = job.agentId?.trim().toLowerCase();
  if (raw) {
    return raw === agentId.toLowerCase();
  }
  return agentId.toLowerCase() === defaultId.toLowerCase();
}

function matchSummary(m: GatewayConfigBinding['match']): string {
  const parts = [m.channel, m.accountId, m.peerKind, m.peerId].filter(
    (x): x is string => typeof x === 'string' && x.length > 0,
  );
  return parts.join(' · ') || m.channel;
}

export function AgentsSettingsPanel() {
  const language = useLocaleStore((s) => s.language);
  const m = messages(language);
  const a = m.agentsSettings;
  const chat = m.chat;
  const token = useGatewayStore((st) => st.token);
  const hasToken = Boolean(token);
  const [searchParams, setSearchParams] = useSearchParams();

  const [data, setData] = useState<GatewayAgentsPayload | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [panel, setPanel] = useState<AgentPanel>('defaults');

  const [createName, setCreateName] = useState('');
  const [createWorkspace, setCreateWorkspace] = useState('');
  const [createModel, setCreateModel] = useState('');
  const [addAgentModalOpen, setAddAgentModalOpen] = useState(false);
  const createWorkspaceSuggestedRef = useRef('');
  const [busy, setBusy] = useState(false);

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
  const [bindingsLoading, setBindingsLoading] = useState(false);
  const [newBindChannel, setNewBindChannel] = useState('');
  const [newBindPeerId, setNewBindPeerId] = useState('');

  const [cronJobs, setCronJobs] = useState<CronJob[]>([]);
  const [cronLoading, setCronLoading] = useState(false);

  const [skillCatalog, setSkillCatalog] = useState<SkillCatalogRow[]>([]);
  const [skillsCatalogLoading, setSkillsCatalogLoading] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const p = await fetchGatewayAgents();
      setData(p);
      setSelectedId((prev) => {
        if (prev && p.agents.some((x) => x.id === prev)) {
          return prev;
        }
        return p.defaultId;
      });
    } catch (e) {
      setError(e instanceof Error ? e.message : a.loadError);
      setData(null);
    } finally {
      setLoading(false);
    }
  }, [a.loadError]);

  useEffect(() => {
    if (!hasToken) {
      setLoading(false);
      return;
    }
    void load();
  }, [hasToken, load]);

  useEffect(() => {
    if (searchParams.get('panel') !== 'defaults') {
      return;
    }
    setPanel('defaults');
    const next = new URLSearchParams(searchParams);
    next.delete('panel');
    setSearchParams(next, { replace: true });
  }, [searchParams, setSearchParams]);

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
    let cancelled = false;
    setBindingsLoading(true);
    void fetchGatewayConfigBindings()
      .then((b) => {
        if (!cancelled) {
          setAllBindings(b);
        }
      })
      .catch(() => {
        if (!cancelled) {
          setAllBindings([]);
        }
      })
      .finally(() => {
        if (!cancelled) {
          setBindingsLoading(false);
        }
      });
    return () => {
      cancelled = true;
    };
  }, [panel, hasToken]);

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
      })
      .catch(() => {
        if (!cancelled) {
          const key = `${selectedId}:${activeFile}`;
          bootstrapFileKeyRef.current = key;
          bootstrapSyncedRef.current = '';
          setFileDraft('');
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

  async function onCreate(e: React.FormEvent) {
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
      setData(next);
      setCreateName('');
      setCreateWorkspace('');
      setCreateModel('');
      setAddAgentModalOpen(false);
      const id = next.agents[next.agents.length - 1]?.id;
      if (id) {
        setSelectedId(id);
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
      setData(next);
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
      setData(next);
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
      setData(next);
      setSelectedId(next.defaultId);
      setPanel('overview');
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
      setData(next);
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
      setData(next);
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
      setData(next);
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

  async function onAddBinding(e: React.FormEvent) {
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

  if (!hasToken) {
    return (
      <div className="mx-auto flex w-full max-w-app-main flex-col gap-3 px-4 py-8">
        <h1 className="text-lg font-semibold text-fg">{a.title}</h1>
        <p className="text-sm text-fg-muted">{a.needToken}</p>
      </div>
    );
  }

  return (
    <div className="mx-auto flex w-full max-w-app-main flex-col gap-6 px-4 py-8">
      <div className="flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between sm:gap-3">
        <div className="min-w-0">
          <h1 className="text-lg font-semibold text-fg">{a.title}</h1>
          <p className="mt-1 text-sm text-fg-muted">{a.subtitle}</p>
        </div>
        {data && !loading && panel !== 'defaults' ? (
          <div className="flex flex-col gap-2 sm:flex-row sm:items-end sm:justify-end sm:gap-3">
            <div className="w-full max-w-[9rem] shrink-0 sm:w-[9rem]">
              <select
                className={cn(inputClass(), 'w-full')}
                aria-label={a.agent}
                value={selectedId ?? ''}
                onChange={(e) => setSelectedId(e.target.value)}
              >
                {data.agents.map((ag) => (
                  <option key={ag.id} value={ag.id}>
                    {ag.name ? `${ag.name} (${ag.id})` : ag.id}
                    {ag.isDefault ? ` — ${a.defaultBadge}` : ''}
                  </option>
                ))}
              </select>
            </div>
            <Button
              type="button"
              variant="secondary"
              className="shrink-0 gap-1.5 rounded-xl px-3 sm:self-end"
              aria-label={a.addAgentAria}
              disabled={busy}
              onClick={() => openAddAgentModal()}
            >
              <Plus className="size-4 shrink-0" strokeWidth={2} aria-hidden />
              <span>{a.addAgent}</span>
            </Button>
          </div>
        ) : null}
      </div>

      {error ? (
        <div className="rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-800 dark:border-red-900/50 dark:bg-red-950/40 dark:text-red-200">
          {error}
        </div>
      ) : null}

      <div className="flex flex-wrap gap-2 border-b border-edge-subtle pb-2">
        <button
          type="button"
          className={cn(
            'rounded-lg px-3 py-1.5 text-sm font-medium',
            panel === 'defaults' ? 'bg-accent-soft text-accent-fg' : 'text-fg-muted hover:bg-surface-hover',
          )}
          onClick={() => setPanel('defaults')}
        >
          {a.tabDefaults}
        </button>
        <button
          type="button"
          className={cn(
            'rounded-lg px-3 py-1.5 text-sm font-medium',
            panel === 'overview' ? 'bg-accent-soft text-accent-fg' : 'text-fg-muted hover:bg-surface-hover',
          )}
          onClick={() => setPanel('overview')}
        >
          {a.tabOverview}
        </button>
        <button
          type="button"
          className={cn(
            'rounded-lg px-3 py-1.5 text-sm font-medium',
            panel === 'files' ? 'bg-accent-soft text-accent-fg' : 'text-fg-muted hover:bg-surface-hover',
          )}
          onClick={() => setPanel('files')}
        >
          {a.tabFiles}
        </button>
        <button
          type="button"
          className={cn(
            'rounded-lg px-3 py-1.5 text-sm font-medium',
            panel === 'tools' ? 'bg-accent-soft text-accent-fg' : 'text-fg-muted hover:bg-surface-hover',
          )}
          onClick={() => setPanel('tools')}
        >
          {a.tabTools}
        </button>
        <button
          type="button"
          className={cn(
            'rounded-lg px-3 py-1.5 text-sm font-medium',
            panel === 'skills' ? 'bg-accent-soft text-accent-fg' : 'text-fg-muted hover:bg-surface-hover',
          )}
          onClick={() => setPanel('skills')}
        >
          {a.tabSkills}
        </button>
        <button
          type="button"
          className={cn(
            'rounded-lg px-3 py-1.5 text-sm font-medium',
            panel === 'channels' ? 'bg-accent-soft text-accent-fg' : 'text-fg-muted hover:bg-surface-hover',
          )}
          onClick={() => setPanel('channels')}
        >
          {a.tabChannels}
        </button>
        <button
          type="button"
          className={cn(
            'rounded-lg px-3 py-1.5 text-sm font-medium',
            panel === 'cron' ? 'bg-accent-soft text-accent-fg' : 'text-fg-muted hover:bg-surface-hover',
          )}
          onClick={() => setPanel('cron')}
        >
          {a.tabCron}
        </button>
      </div>

      {panel === 'defaults' ? (
        <AgentSettingsPanel embedded />
      ) : loading ? (
        <p className="text-sm text-fg-muted">{a.loading}</p>
      ) : data ? (
        panel === 'overview' ? (
          <div className="flex flex-col gap-8">
            <SettingsFormSection>
              <SettingsFormSectionHeader icon={Users} title={a.selectAgent} subtitle={a.selectAgentHint} />
              <div className="flex flex-wrap gap-2">
                <Button
                  type="button"
                  variant="secondary"
                  disabled={!selected || selected.isDefault || busy}
                  onClick={() => selected && void onSetDefault(selected)}
                >
                  {a.setDefault}
                </Button>
              </div>
            </SettingsFormSection>

            {selected ? (
              <SettingsFormSection>
                <SettingsFormSectionHeader icon={ListTree} title={a.editAgent} subtitle={a.editAgentHint} />
                <div className="grid gap-3 sm:grid-cols-2">
                  <label className="flex flex-col gap-1 text-sm">
                    <span className="text-fg-muted">{a.displayName}</span>
                    <input
                      className={inputClass()}
                      value={editName}
                      onChange={(e) => setEditName(e.target.value)}
                    />
                  </label>
                  <label className="flex flex-col gap-1 text-sm sm:col-span-2">
                    <span className="text-fg-muted">{a.workspacePath}</span>
                    <input
                      className={cn(inputClass(), 'font-mono text-xs')}
                      value={editWorkspace}
                      onChange={(e) => setEditWorkspace(e.target.value)}
                    />
                  </label>
                  <div className="flex flex-col gap-1 text-sm sm:col-span-2">
                    <span className="text-fg-muted">{a.modelPrimary}</span>
                    <div className="flex flex-wrap items-stretch gap-2">
                      <ModelSelector
                        className="min-w-0 flex-1"
                        value={editModel}
                        disabled={busy}
                        placeholder={chat.modelPlaceholder}
                        searchPlaceholder={chat.modelSearchPlaceholder}
                        noMatches={chat.modelNoMatches}
                        onChange={(id) => setEditModel(id)}
                      />
                      {editModel.trim() ? (
                        <Button
                          type="button"
                          variant="secondary"
                          className="shrink-0"
                          disabled={busy}
                          onClick={() => setEditModel('')}
                        >
                          {a.modelClear}
                        </Button>
                      ) : null}
                    </div>
                  </div>
                </div>
                <div className="mt-4 flex flex-wrap gap-2">
                  <Button type="button" disabled={busy} onClick={() => void onSaveAgentEdits()}>
                    {a.save}
                  </Button>
                  {selected.id !== 'main' ? (
                    <>
                      <Button
                        type="button"
                        variant="secondary"
                        disabled={busy}
                        onClick={() => void onDelete(selected, false)}
                      >
                        <Trash2 className="mr-1 size-4" aria-hidden />
                        {a.removeFromConfig}
                      </Button>
                      <Button
                        type="button"
                        variant="secondary"
                        className="border-red-200 text-red-700 hover:bg-red-50 dark:border-red-900/60 dark:text-red-300 dark:hover:bg-red-950/40"
                        disabled={busy}
                        onClick={() => void onDelete(selected, true)}
                      >
                        {a.purgeDisk}
                      </Button>
                    </>
                  ) : null}
                </div>
              </SettingsFormSection>
            ) : null}
          </div>
        ) : panel === 'files' ? (
          <div className="flex flex-col gap-4">
            <p className="text-sm text-fg-muted">{a.filesHint}</p>
            {filesLoading ? (
              <p className="text-sm text-fg-muted">{a.filesLoading}</p>
            ) : files ? (
              <div className="flex min-h-0 flex-col gap-3">
                <nav
                  className="flex flex-row flex-wrap gap-x-0.5 gap-y-0 border-b border-edge-subtle"
                  aria-label={a.tabFiles}
                >
                  {files.files.map((f) => (
                    <button
                      key={f.name}
                      type="button"
                      className={cn(
                        '-mb-px shrink-0 border-b-2 border-transparent px-3 py-2 text-left font-mono text-xs whitespace-nowrap transition-colors',
                        activeFile === f.name
                          ? 'border-accent text-fg'
                          : 'text-fg-muted hover:border-edge-subtle hover:text-fg',
                        f.missing && 'opacity-60',
                      )}
                      onClick={() => setActiveFile(f.name)}
                    >
                      {f.name}
                      {f.missing ? ` (${a.missing})` : ''}
                    </button>
                  ))}
                </nav>
                <div className="flex min-h-0 min-w-0 flex-col gap-2">
                  {activeFile ? (
                    <>
                      <div className="flex flex-wrap items-center justify-between gap-2">
                        <div
                          className="inline-flex rounded-lg border border-edge bg-surface-panel p-0.5"
                          role="group"
                          aria-label={a.filesBootstrapEdit}
                        >
                          <button
                            type="button"
                            className={cn(
                              'inline-flex items-center gap-1.5 rounded-md px-2.5 py-1.5 text-xs font-medium',
                              bootstrapViewMode === 'edit'
                                ? 'bg-accent-soft text-accent-fg'
                                : 'text-fg-muted hover:bg-surface-hover',
                            )}
                            onClick={() => setBootstrapViewMode('edit')}
                          >
                            <SquarePen className="size-3.5 shrink-0" aria-hidden />
                            {a.filesBootstrapEdit}
                          </button>
                          <button
                            type="button"
                            className={cn(
                              'inline-flex items-center gap-1.5 rounded-md px-2.5 py-1.5 text-xs font-medium',
                              bootstrapViewMode === 'preview'
                                ? 'bg-accent-soft text-accent-fg'
                                : 'text-fg-muted hover:bg-surface-hover',
                            )}
                            onClick={() => setBootstrapViewMode('preview')}
                          >
                            <Eye className="size-3.5 shrink-0" aria-hidden />
                            {a.filesBootstrapPreview}
                          </button>
                        </div>
                        <div className="flex flex-wrap items-center gap-2 text-xs text-fg-muted">
                          {fileSaving ? <span>{a.filesSavingStatus}</span> : null}
                          <span>{a.filesAutoSaveHint}</span>
                        </div>
                      </div>
                      {bootstrapViewMode === 'edit' ? (
                        <textarea
                          className={cn(
                            inputClass(),
                            'min-h-[min(36rem,65vh)] flex-1 font-mono text-xs sm:min-h-[40rem]',
                          )}
                          value={fileDraft}
                          disabled={bootstrapFileLoading}
                          onChange={(e) => setFileDraft(e.target.value)}
                        />
                      ) : (
                        <div
                          className={cn(
                            inputClass(),
                            'min-h-[min(36rem,65vh)] flex-1 overflow-auto text-sm sm:min-h-[40rem]',
                            bootstrapFileLoading && 'pointer-events-none opacity-60',
                          )}
                        >
                          <MarkdownView content={fileDraft} className="text-sm" />
                        </div>
                      )}
                    </>
                  ) : (
                    <p className="text-sm text-fg-muted">{a.pickFile}</p>
                  )}
                </div>
              </div>
            ) : (
              <p className="text-sm text-fg-muted">{a.filesEmpty}</p>
            )}
          </div>
        ) : panel === 'tools' && selected ? (
          <SettingsFormSection>
            <SettingsFormSectionHeader icon={Wrench} title={a.toolsTitle} subtitle={a.toolsHint} />
            <div className="h-[20rem] min-h-0 overflow-y-auto overscroll-contain">
              <ul className="flex flex-col gap-2.5 pr-1" role="list">
                {(data.builtinToolIds.length ? data.builtinToolIds : []).map((tid) => {
                  const disabledByDefault = selected.tools.defaultsDisable.includes(tid);
                  const checked = disabledByDefault ? false : !toolEntryDisable.has(tid);
                  const desc =
                    tid in a.toolDescriptions
                      ? a.toolDescriptions[tid as keyof typeof a.toolDescriptions]
                      : '';
                  return (
                    <li
                      key={tid}
                      className={cn(
                        'rounded-xl border border-edge-subtle bg-surface-panel/60 px-3 py-2.5 dark:border-edge-subtle',
                        disabledByDefault && 'opacity-60',
                      )}
                    >
                      <label
                        className={cn(
                          'flex cursor-pointer gap-3 text-sm',
                          disabledByDefault && 'cursor-not-allowed',
                        )}
                      >
                        <input
                          type="checkbox"
                          className="mt-1 shrink-0 rounded border-edge"
                          checked={checked}
                          disabled={disabledByDefault || busy}
                          onChange={() => {
                            if (disabledByDefault) {
                              return;
                            }
                            setToolEntryDisable((prev) => {
                              const next = new Set(prev);
                              if (next.has(tid)) {
                                next.delete(tid);
                              } else {
                                next.add(tid);
                              }
                              return next;
                            });
                          }}
                        />
                        <div className="min-w-0 flex-1">
                          <div className="flex flex-wrap items-center gap-x-2 gap-y-0.5">
                            <span className="font-mono text-xs font-medium text-fg">{tid}</span>
                            {disabledByDefault ? (
                              <span className="text-xs text-fg-muted">({a.toolsLockedByDefaults})</span>
                            ) : null}
                          </div>
                          {desc ? (
                            <p className="mt-1 text-xs leading-relaxed text-fg-muted">{desc}</p>
                          ) : null}
                        </div>
                      </label>
                    </li>
                  );
                })}
              </ul>
            </div>
            <div className="mt-4 flex flex-wrap gap-2">
              <Button type="button" disabled={busy} onClick={() => void onSaveTools()}>
                {a.toolsSave}
              </Button>
              <Button type="button" variant="secondary" disabled={busy} onClick={() => void onClearToolsEntry()}>
                {a.toolsClearEntry}
              </Button>
            </div>
          </SettingsFormSection>
        ) : panel === 'skills' && selected ? (
          <SettingsFormSection>
            <SettingsFormSectionHeader icon={BookOpen} title={a.skillsTitle} subtitle={a.skillsHint} />
            <div className="flex flex-wrap gap-2">
              <Button
                type="button"
                variant="secondary"
                disabled={busy}
                onClick={() => {
                  setSkillsInherit(true);
                }}
              >
                {a.skillsInherit}
              </Button>
              <Button
                type="button"
                variant="secondary"
                disabled={busy}
                onClick={() => {
                  setSkillsInherit(false);
                  setSkillsPick(
                    new Set(
                      selected.skills.effectiveAllowlist?.length
                        ? selected.skills.effectiveAllowlist
                        : selected.skills.defaults,
                    ),
                  );
                }}
              >
                {a.skillsCustomize}
              </Button>
            </div>
            <p className="mt-2 text-xs text-fg-muted">
              {a.skillsDefaultsLabel}{' '}
              {selected.skills.defaults.length ? selected.skills.defaults.join(', ') : '—'}
            </p>
            <p className="text-xs text-fg-muted">
              {a.skillsEffectiveLabel}{' '}
              {selected.skills.effectiveAllowlist?.length
                ? selected.skills.effectiveAllowlist.join(', ')
                : a.skillsAllFromCatalog}
            </p>
            {skillsCatalogLoading ? (
              <p className="text-sm text-fg-muted">{a.skillsCatalogLoading}</p>
            ) : catalogForPick.length === 0 ? (
              <p className="text-sm text-fg-muted">{a.skillsEmptyCatalog}</p>
            ) : (
              <div
                className={cn(
                  'mt-3 h-[20rem] min-h-0 overflow-y-auto overscroll-contain pr-0.5',
                  skillsInherit && 'opacity-50',
                )}
              >
                <ul className="flex flex-col gap-2.5 text-sm" role="list">
                  {catalogForPick.map((s) => {
                    const id = s.name || s.directoryId;
                    const on = skillsPick.has(id);
                    const desc = typeof s.description === 'string' ? s.description.trim() : '';
                    const descLine = desc || a.skillsNoDescription;
                    return (
                      <li
                        key={id}
                        className="h-16 shrink-0 overflow-hidden rounded-xl border border-edge-subtle bg-surface-panel/60 px-3 dark:border-edge-subtle"
                      >
                        <label className="flex h-full cursor-pointer items-center gap-3 text-sm">
                          <input
                            type="checkbox"
                            className="shrink-0 rounded border-edge"
                            checked={on}
                            disabled={skillsInherit || busy}
                            onChange={() => {
                              setSkillsPick((prev) => {
                                const next = new Set(prev);
                                if (on) {
                                  next.delete(id);
                                } else {
                                  next.add(id);
                                }
                                return next;
                              });
                            }}
                          />
                          <div className="min-w-0 flex-1 overflow-hidden">
                            <div className="truncate font-mono text-xs font-medium text-fg" title={id}>
                              {id}
                            </div>
                            <p
                              className={cn(
                                'mt-0.5 truncate text-xs leading-tight text-fg-muted',
                                !desc && 'italic text-fg-subtle',
                              )}
                              title={descLine}
                            >
                              {descLine}
                            </p>
                          </div>
                        </label>
                      </li>
                    );
                  })}
                </ul>
              </div>
            )}
            <div className="mt-4">
              <Button type="button" disabled={busy} onClick={() => void onSaveSkills()}>
                {a.skillsSave}
              </Button>
            </div>
          </SettingsFormSection>
        ) : panel === 'channels' && selected ? (
          <SettingsFormSection>
            <SettingsFormSectionHeader icon={Link2} title={a.channelsTitle} subtitle={a.channelsHint} />
            {bindingsLoading ? (
              <p className="text-sm text-fg-muted">{a.channelsLoading}</p>
            ) : agentBindings.length === 0 ? (
              <p className="text-sm text-fg-muted">{a.channelsNone}</p>
            ) : (
              <ul className="flex flex-col gap-2 text-sm">
                {agentBindings.map((b, i) => (
                  <li
                    key={`${b.match.channel}-${i}`}
                    className="flex flex-wrap items-center justify-between gap-2 rounded-lg border border-edge bg-surface-panel px-3 py-2"
                  >
                    <span className="font-mono text-xs">{matchSummary(b.match)}</span>
                    <Button type="button" variant="secondary" disabled={busy} onClick={() => void onRemoveBinding(b)}>
                      {a.removeBinding}
                    </Button>
                  </li>
                ))}
              </ul>
            )}
            <form className="mt-4 grid gap-2 sm:grid-cols-2" onSubmit={onAddBinding}>
              <label className="flex flex-col gap-1 text-sm sm:col-span-2">
                <span className="text-fg-muted">{a.channelLabel}</span>
                <input
                  className={inputClass()}
                  value={newBindChannel}
                  onChange={(e) => setNewBindChannel(e.target.value)}
                  placeholder="telegram"
                />
              </label>
              <label className="flex flex-col gap-1 text-sm sm:col-span-2">
                <span className="text-fg-muted">{a.peerIdLabel}</span>
                <input
                  className={inputClass()}
                  value={newBindPeerId}
                  onChange={(e) => setNewBindPeerId(e.target.value)}
                />
              </label>
              <div className="sm:col-span-2">
                <Button type="submit" disabled={busy || !newBindChannel.trim()}>
                  {a.addBinding}
                </Button>
              </div>
            </form>
          </SettingsFormSection>
        ) : panel === 'cron' && selected && data ? (
          <SettingsFormSection>
            <SettingsFormSectionHeader icon={AlarmClock} title={a.cronTitle} subtitle={a.cronHint} />
            {cronLoading ? (
              <p className="text-sm text-fg-muted">{a.cronLoading}</p>
            ) : agentCronJobs.length === 0 ? (
              <p className="text-sm text-fg-muted">{a.cronNone}</p>
            ) : (
              <div className="overflow-x-auto">
                <table className="w-full min-w-[32rem] border-collapse text-left text-sm">
                  <thead>
                    <tr className="border-b border-edge text-fg-muted">
                      <th className="py-2 pr-3 font-medium">{a.cronColSchedule}</th>
                      <th className="py-2 pr-3 font-medium">{a.cronColMessage}</th>
                      <th className="py-2 pr-3 font-medium">{a.cronColSession}</th>
                      <th className="py-2 pr-3 font-medium">{a.cronColAgent}</th>
                    </tr>
                  </thead>
                  <tbody>
                    {agentCronJobs.map((job) => {
                      const usesDefaultAgent = !job.agentId?.trim();
                      const value = usesDefaultAgent ? '' : job.agentId!.trim().toLowerCase();
                      return (
                        <tr key={job.id} className="border-b border-edge-subtle">
                          <td className="py-2 pr-3 font-mono text-xs">{job.schedule}</td>
                          <td className="max-w-[12rem] truncate py-2 pr-3 text-xs" title={cronJobBodyText(job)}>
                            {cronJobBodyText(job)}
                          </td>
                          <td className="py-2 pr-3 text-xs">{job.sessionTarget ?? 'main'}</td>
                          <td className="py-2 pr-3">
                            <select
                              className={cn(inputClass(), 'min-w-[8rem] py-1 text-xs')}
                              value={value}
                              disabled={busy || job.sessionTarget !== 'isolated'}
                              onChange={(e) => void onSetCronJobAgent(job, e.target.value)}
                            >
                              <option value="">
                                {usesDefaultAgent ? a.cronAgentDefault : a.cronAgentClear}
                              </option>
                              {data.agents.map((ag) => (
                                <option key={ag.id} value={ag.id}>
                                  {ag.id}
                                </option>
                              ))}
                            </select>
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            )}
          </SettingsFormSection>
        ) : (
          <p className="text-sm text-fg-muted">{a.selectAgentHint}</p>
        )
      ) : null}

      <Dialog.Root
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
      >
        <Dialog.Portal>
          <Dialog.Overlay className="xopcbot-dialog-overlay fixed inset-0 z-[60] bg-scrim" />
          <Dialog.Content
            className={cn(
              'xopcbot-dialog-content fixed left-1/2 top-1/2 z-[60] max-h-[min(90vh,640px)] w-[min(100%-2rem,28rem)] -translate-x-1/2 -translate-y-1/2',
              'overflow-y-auto rounded-xl border border-edge bg-surface-panel p-4 shadow-popover dark:border-edge',
            )}
            onOpenAutoFocus={(e) => e.preventDefault()}
          >
            <div className="mb-3 flex items-start justify-between gap-2">
              <div className="min-w-0 pr-2">
                <Dialog.Title className="text-base font-semibold text-fg">{a.addAgent}</Dialog.Title>
                <Dialog.Description className="mt-0.5 text-xs text-fg-muted">{a.addAgentHint}</Dialog.Description>
              </div>
              <Dialog.Close asChild>
                <button
                  type="button"
                  className="shrink-0 rounded-lg p-1.5 text-fg-muted hover:bg-surface-base hover:text-fg focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent/40"
                  aria-label={a.closeDialogAria}
                >
                  <X className="size-4" aria-hidden />
                </button>
              </Dialog.Close>
            </div>

            <form className="grid gap-3" onSubmit={onCreate}>
              <label className="flex flex-col gap-1 text-sm">
                <span className="text-fg-muted">{a.newName}</span>
                <input
                  className={inputClass()}
                  value={createName}
                  onChange={(e) => setCreateName(e.target.value)}
                  onBlur={() => applyCreateWorkspaceSuggestion()}
                  required
                  autoComplete="off"
                />
              </label>
              <label className="flex flex-col gap-1 text-sm">
                <span className="text-fg-muted">{a.newWorkspace}</span>
                <input
                  className={cn(inputClass(), 'font-mono text-xs')}
                  value={createWorkspace}
                  onChange={(e) => setCreateWorkspace(e.target.value)}
                  required
                  autoComplete="off"
                />
              </label>
              <div className="flex flex-col gap-1 text-sm">
                <span className="text-fg-muted">{a.newModelOptional}</span>
                <div className="flex flex-wrap items-stretch gap-2">
                  <ModelSelector
                    className="min-w-0 flex-1"
                    popoverContentClassName="z-[70]"
                    value={createModel}
                    disabled={busy}
                    placeholder={chat.modelPlaceholder}
                    searchPlaceholder={chat.modelSearchPlaceholder}
                    noMatches={chat.modelNoMatches}
                    onChange={(id) => setCreateModel(id)}
                  />
                  {createModel.trim() ? (
                    <Button
                      type="button"
                      variant="secondary"
                      className="shrink-0"
                      disabled={busy}
                      onClick={() => setCreateModel('')}
                    >
                      {a.modelClear}
                    </Button>
                  ) : null}
                </div>
              </div>
              <div className="mt-1 flex justify-end gap-2 border-t border-edge-subtle pt-3 dark:border-edge">
                <Dialog.Close asChild>
                  <Button type="button" variant="secondary" disabled={busy}>
                    {a.createModalCancel}
                  </Button>
                </Dialog.Close>
                <Button type="submit" disabled={busy}>
                  <UserPlus className="mr-1 size-4" aria-hidden />
                  {a.create}
                </Button>
              </div>
            </form>
          </Dialog.Content>
        </Dialog.Portal>
      </Dialog.Root>
    </div>
  );
}
