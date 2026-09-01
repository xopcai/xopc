import * as Dialog from '@radix-ui/react-dialog';
import * as Popover from '@radix-ui/react-popover';
import { Archive, ChevronDown, ChevronLeft, ChevronRight, Download, ExternalLink, GitBranch, LockKeyhole, Plus, Search, ShieldCheck, Store, Trash2, Upload, X, type LucideIcon } from 'lucide-react';
import { useCallback, useEffect, useRef, useState } from 'react';

import { Button } from '@/components/ui/button';
import { PopoverSelect } from '@/components/ui/popover-select';
import { Skeleton } from '@/components/ui/skeleton';
import { getChatSkillsCached, type ChatSkillsPayload } from '@/features/chat/palette/command-palette-api';
import { getMarketplaceSkills } from '@/features/skills/skill-api';
import { SkillCardIcon } from '@/features/skills/skill-card-icon';
import type { SkillsMarketplacePayload } from '@/features/skills/skill.types';
import { marketplacePackageRequestName } from '@/features/skills/skills-page.utils';
import { cn } from '@/lib/cn';
import { fetchProjectSessions, type ProjectSession } from './api';
import {
  deleteProjectSkill,
  fetchProjectSkill,
  fetchProjectSkills,
  installProjectSkillFromMarketplace,
  installProjectSkillFromSource,
  setProjectWorkspaceTrust,
  uploadProjectSkill,
  type ProjectSkill,
  type ProjectSkillDiagnostic,
  type ProjectSkillSource,
} from './project-skills-api';

type Copy = {
  title: string;
  description: string;
  add: string;
  empty: string;
  emptyHint: string;
  path: string;
  xopcSource: string;
  agentsSource: string;
  sourceReadOnly: string;
  sourceStateActive: string;
  sourceStateMissing: string;
  sourceStateDisabled: string;
  sourceStateUntrusted: string;
  sourceStateInvalid: string;
  trustTitle: string;
  trustHint: string;
  trustAction: string;
  trusting: string;
  shadowed: string;
  diagnosticsTitle: string;
  localTitle: string;
  inheritedTitle: string;
  inheritedHint: string;
  sessionViewLabel: string;
  sessionViewAll: string;
  sessionFallback: string;
  sessionLoading: string;
  sessionAvailable: string;
  sessionUnavailableAgent: string;
  sessionUnavailableDisabled: string;
  sessionUnavailableRequirements: string;
  sessionUnavailableModel: string;
  sessionUnavailableTools: string;
  globalXopcSource: string;
  globalAgentsSource: string;
  bundledSource: string;
  extraSource: string;
  view: string;
  remove: string;
  removeConfirm: string;
  marketplace: string;
  marketplaceHint: string;
  marketplacePlaceholder: string;
  marketplaceEmpty: string;
  marketplaceDownloads: string;
  marketplaceInstalled: string;
  marketplacePrevious: string;
  marketplaceNext: string;
  marketplacePage: string;
  source: string;
  sourceHint: string;
  sourcePlaceholder: string;
  upload: string;
  uploadHint: string;
  install: string;
  installing: string;
  close: string;
};

export function ProjectSkillsPanel({ projectId, copy }: { projectId: string; copy: Copy }) {
  const [items, setItems] = useState<ProjectSkill[]>([]);
  const [inheritedItems, setInheritedItems] = useState<ProjectSkill[]>([]);
  const [sources, setSources] = useState<ProjectSkillSource[]>([]);
  const [diagnostics, setDiagnostics] = useState<ProjectSkillDiagnostic[]>([]);
  const [sessions, setSessions] = useState<ProjectSession[]>([]);
  const [selectedSessionKey, setSelectedSessionKey] = useState('');
  const [sessionSkills, setSessionSkills] = useState<ChatSkillsPayload | null>(null);
  const [sessionSkillsLoading, setSessionSkillsLoading] = useState(false);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [installingMarketplaceSkill, setInstallingMarketplaceSkill] = useState<string | null>(null);
  const [error, setError] = useState('');
  const [installMode, setInstallMode] = useState<'marketplace' | 'source' | null>(null);
  const [preview, setPreview] = useState<ProjectSkill | null>(null);
  const [marketplaceQuery, setMarketplaceQuery] = useState('');
  const [marketplacePage, setMarketplacePage] = useState(1);
  const [marketplacePayload, setMarketplacePayload] = useState<SkillsMarketplacePayload | null>(null);
  const [marketplaceLoading, setMarketplaceLoading] = useState(false);
  const [marketplaceError, setMarketplaceError] = useState('');
  const [source, setSource] = useState('');
  const fileRef = useRef<HTMLInputElement>(null);

  const reload = useCallback(async () => {
    setLoading(true);
    setError('');
    try {
      const result = await fetchProjectSkills(projectId);
      setItems(result.items);
      setInheritedItems(result.inheritedItems);
      setSources(result.sources);
      setDiagnostics(result.diagnostics);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setLoading(false);
    }
  }, [projectId]);

  useEffect(() => { void reload(); }, [reload]);

  useEffect(() => {
    let cancelled = false;
    void fetchProjectSessions(projectId).then((result) => {
      if (!cancelled) setSessions(result);
    }).catch(() => {
      if (!cancelled) setSessions([]);
    });
    return () => { cancelled = true; };
  }, [projectId]);

  useEffect(() => {
    if (!selectedSessionKey) {
      setSessionSkills(null);
      return;
    }
    const session = sessions.find((candidate) => candidate.key === selectedSessionKey);
    let cancelled = false;
    setSessionSkills(null);
    setError('');
    setSessionSkillsLoading(true);
    void getChatSkillsCached(session?.agentId ?? session?.routing?.agentId, selectedSessionKey, true)
      .then((payload) => { if (!cancelled) setSessionSkills(payload); })
      .catch((err: unknown) => { if (!cancelled) setError(err instanceof Error ? err.message : String(err)); })
      .finally(() => { if (!cancelled) setSessionSkillsLoading(false); });
    return () => { cancelled = true; };
  }, [selectedSessionKey, sessions]);

  useEffect(() => {
    if (installMode !== 'marketplace') return;
    const controller = new AbortController();
    const timer = window.setTimeout(() => {
      setMarketplaceLoading(true);
      setMarketplaceError('');
      void getMarketplaceSkills({
        q: marketplaceQuery,
        page: marketplacePage,
        pageSize: 8,
        sort: 'downloads',
        signal: controller.signal,
      }).then(setMarketplacePayload).catch((err: unknown) => {
        if (!controller.signal.aborted) setMarketplaceError(err instanceof Error ? err.message : String(err));
      }).finally(() => {
        if (!controller.signal.aborted) setMarketplaceLoading(false);
      });
    }, 250);
    return () => {
      window.clearTimeout(timer);
      controller.abort();
    };
  }, [installMode, marketplacePage, marketplaceQuery]);

  async function runInstall(action: () => Promise<unknown>, marketplaceSkill?: string) {
    setBusy(true);
    setInstallingMarketplaceSkill(marketplaceSkill ?? null);
    setError('');
    try {
      await action();
      setInstallMode(null);
      setSource('');
      await reload();
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setBusy(false);
      setInstallingMarketplaceSkill(null);
    }
  }

  async function openPreview(skillKey: string) {
    setError('');
    try {
      setPreview((await fetchProjectSkill(projectId, skillKey)).skill);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    }
  }

  async function removeSkill(skill: ProjectSkill) {
    if (!skill.removable) return;
    if (!window.confirm(copy.removeConfirm.replace('{{name}}', skill.name))) return;
    setBusy(true);
    try {
      await deleteProjectSkill(projectId, skill.directoryId);
      await reload();
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setBusy(false);
    }
  }

  async function trustProject() {
    setBusy(true);
    setError('');
    try {
      await setProjectWorkspaceTrust(projectId, true);
      await reload();
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setBusy(false);
    }
  }

  const agentsSource = sources.find((source) => source.origin === 'agents-workspace');
  const sessionSkillsByName = new Map(sessionSkills?.skills.map((skill) => [skill.name, skill]));

  return (
    <section id="project-panel-skills" role="tabpanel" aria-labelledby="project-primary-tab-skills" className="grid content-start gap-4">
      <div className="rounded-lg bg-surface-panel p-4 shadow-surface">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div>
            <h2 className="text-sm font-semibold text-fg">{copy.title}</h2>
            <p className="mt-1 text-sm leading-6 text-fg-muted">{copy.description}</p>
          </div>
          <Popover.Root>
            <Popover.Trigger asChild>
              <Button type="button">
                <Plus className="size-4" aria-hidden />
                {copy.add}
                <ChevronDown className="size-3.5" aria-hidden />
              </Button>
            </Popover.Trigger>
            <Popover.Portal>
              <Popover.Content align="end" sideOffset={8} className="z-50 w-72 rounded-lg border border-edge bg-surface-panel p-1.5 shadow-xl">
                <InstallEntry icon={Store} title={copy.marketplace} hint={copy.marketplaceHint} onClick={() => setInstallMode('marketplace')} />
                <InstallEntry icon={GitBranch} title={copy.source} hint={copy.sourceHint} onClick={() => setInstallMode('source')} />
                <InstallEntry icon={Upload} title={copy.upload} hint={copy.uploadHint} onClick={() => fileRef.current?.click()} />
              </Popover.Content>
            </Popover.Portal>
          </Popover.Root>
          <input
            ref={fileRef}
            type="file"
            accept=".zip,application/zip"
            className="hidden"
            onChange={(event) => {
              const file = event.target.files?.[0];
              if (file) void runInstall(() => uploadProjectSkill(projectId, file));
              event.target.value = '';
            }}
          />
        </div>
        {sources.length ? (
          <div className="mt-3 grid gap-2 rounded-md border border-edge-subtle bg-surface-base p-3">
            {sources.map((skillSource) => (
              <div key={skillSource.origin} className="flex min-w-0 flex-wrap items-center gap-x-2 gap-y-1 text-xs">
                <span className="font-medium text-fg">
                  {skillSource.origin === 'xopc-workspace' ? copy.xopcSource : copy.agentsSource}
                </span>
                {!skillSource.writable ? <span className="rounded bg-surface-hover px-1.5 py-0.5 text-fg-muted">{copy.sourceReadOnly}</span> : null}
                <span className="text-fg-subtle">{sourceStateLabel(copy, skillSource.state)}</span>
                <span className="min-w-0 break-all font-mono text-fg-subtle">{copy.path}: {skillSource.rootDir}</span>
              </div>
            ))}
          </div>
        ) : null}
      </div>

      {error ? <p className="rounded-lg border border-red-500/30 bg-red-500/10 px-3 py-2 text-sm text-red-700 dark:text-red-300">{error}</p> : null}

      {agentsSource?.state === 'untrusted' ? (
        <div className="flex flex-wrap items-center justify-between gap-3 rounded-lg border border-amber-500/30 bg-amber-500/10 px-4 py-3">
          <div className="flex min-w-0 items-start gap-3">
            <LockKeyhole className="mt-0.5 size-4 shrink-0 text-amber-700 dark:text-amber-300" aria-hidden />
            <div>
              <p className="text-sm font-medium text-fg">{copy.trustTitle}</p>
              <p className="mt-1 text-xs leading-5 text-fg-muted">{copy.trustHint}</p>
            </div>
          </div>
          <Button type="button" variant="secondary" disabled={busy} onClick={() => void trustProject()}>
            <ShieldCheck className="size-4" aria-hidden />
            {busy ? copy.trusting : copy.trustAction}
          </Button>
        </div>
      ) : null}

      {diagnostics.some((diagnostic) => diagnostic.type !== 'skipped') ? (
        <div className="rounded-lg border border-amber-500/30 bg-amber-500/10 px-4 py-3">
          <p className="text-sm font-medium text-fg">{copy.diagnosticsTitle}</p>
          <ul className="mt-2 grid gap-1 text-xs leading-5 text-fg-muted">
            {diagnostics.filter((diagnostic) => diagnostic.type !== 'skipped').map((diagnostic, index) => (
              <li key={`${diagnostic.type}:${diagnostic.path ?? ''}:${index}`}>{diagnostic.message}</li>
            ))}
          </ul>
        </div>
      ) : null}

      {sessions.length ? (
        <div className="flex flex-wrap items-end justify-between gap-3 rounded-lg border border-edge bg-surface-panel p-4">
          <div>
            <p className="text-sm font-medium text-fg">{copy.sessionViewLabel}</p>
            <p className="mt-1 text-xs text-fg-muted">{sessionSkillsLoading ? copy.sessionLoading : selectedSessionKey ? sessionSkills?.agentId : copy.sessionViewAll}</p>
          </div>
          <PopoverSelect
            value={selectedSessionKey}
            options={sessions.map((session) => ({
              value: session.key,
              label: session.name?.trim() || `${copy.sessionFallback} · ${session.key.slice(-12)}`,
            }))}
            placeholder={copy.sessionViewAll}
            emptyLabel={copy.sessionViewAll}
            triggerClassName="w-[min(24rem,calc(100vw-3rem))]"
            onChange={setSelectedSessionKey}
          />
        </div>
      ) : null}

      {loading ? (
        <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3">{[0, 1, 2].map((item) => <Skeleton key={item} className="h-36 rounded-lg" />)}</div>
      ) : items.length ? (
        <SkillSection
          title={copy.localTitle}
          items={items}
          copy={copy}
          busy={busy}
          availabilityByName={sessionSkillsByName}
          onPreview={openPreview}
          onRemove={removeSkill}
        />
      ) : (
        <div className="rounded-lg border border-dashed border-edge bg-surface-panel px-6 py-12 text-center">
          <h3 className="text-sm font-semibold text-fg">{copy.empty}</h3>
          <p className="mt-2 text-sm text-fg-muted">{copy.emptyHint}</p>
        </div>
      )}

      {!loading && inheritedItems.length ? (
        <SkillSection
          title={copy.inheritedTitle}
          hint={copy.inheritedHint}
          items={inheritedItems}
          copy={copy}
          busy={busy}
          availabilityByName={sessionSkillsByName}
          onPreview={openPreview}
          onRemove={removeSkill}
        />
      ) : null}

      <Dialog.Root open={installMode !== null} onOpenChange={(open) => { if (!open) setInstallMode(null); }}>
        <Dialog.Portal>
          <Dialog.Overlay className="fixed inset-0 z-50 bg-black/45" />
          <Dialog.Content className={cn(
            'fixed left-1/2 top-1/2 z-50 flex -translate-x-1/2 -translate-y-1/2 flex-col overflow-hidden rounded-xl border border-edge bg-surface-panel shadow-xl',
            installMode === 'marketplace'
              ? 'h-[min(46rem,calc(100vh-2rem))] w-[min(58rem,calc(100vw-2rem))]'
              : 'h-[min(22rem,calc(100vh-2rem))] w-[min(36rem,calc(100vw-2rem))]',
          )}>
            <div className="flex shrink-0 items-center justify-between border-b border-edge px-5 py-4">
              <Dialog.Title className="text-base font-semibold text-fg">
                {installMode === 'marketplace' ? copy.marketplace : copy.source}
              </Dialog.Title>
              <Dialog.Close asChild><Button type="button" variant="ghost" className="size-9 p-0"><X className="size-4" /></Button></Dialog.Close>
            </div>
            <div className="min-h-0 flex-1 overflow-y-auto p-5">
              {installMode === 'marketplace' ? <section>
                <h3 className="text-sm font-semibold text-fg">{copy.marketplace}</h3>
                <p className="mt-1 text-xs leading-5 text-fg-muted">{copy.marketplaceHint}</p>
                <div className="relative mt-3">
                  <Search className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-fg-subtle" aria-hidden />
                  <input
                    className="h-10 w-full rounded-md border border-edge bg-surface-base pl-9 pr-3 text-sm outline-none focus:border-accent"
                    value={marketplaceQuery}
                    onChange={(event) => { setMarketplaceQuery(event.target.value); setMarketplacePage(1); }}
                    placeholder={copy.marketplacePlaceholder}
                    autoFocus
                  />
                </div>
                {marketplaceError ? <p className="mt-3 text-sm text-red-600 dark:text-red-300">{marketplaceError}</p> : null}
                {marketplaceLoading && !marketplacePayload ? (
                  <div className="mt-3 grid grid-cols-1 gap-3 sm:grid-cols-2">{[0, 1, 2, 3].map((key) => <Skeleton key={key} className="h-32 rounded-lg" />)}</div>
                ) : marketplacePayload?.items.length ? (
                  <div className="mt-3 grid grid-cols-1 gap-3 sm:grid-cols-2">
                    {marketplacePayload.items.map((row) => {
                      const provider = row.providerId ?? marketplacePayload.provider;
                      const packageName = marketplacePackageRequestName(row, provider);
                      const installed = items.some((item) => item.origin === 'xopc-workspace' && (
                        item.directoryId === row.id || item.directoryId === packageName || item.name === row.name
                      ));
                      const installing = installingMarketplaceSkill === packageName;
                      return (
                        <article key={`${provider ?? 'default'}:${row.id}`} className="group flex min-h-32 gap-3 rounded-lg border border-edge bg-surface-base p-3">
                          <SkillCardIcon name={row.name} className="size-10" />
                          <div className="flex min-w-0 flex-1 flex-col">
                            <h4 className="truncate text-sm font-semibold text-fg">{row.name}</h4>
                            <p className="mt-1 line-clamp-2 text-xs leading-5 text-fg-muted">{row.description || '—'}</p>
                            <div className="mt-auto flex items-end justify-between gap-2 pt-2">
                              <span className="inline-flex items-center gap-1 text-xs text-fg-subtle"><Download className="size-3.5" aria-hidden />{copy.marketplaceDownloads} {row.downloads}</span>
                              <Button
                                type="button"
                                className="h-8 px-2.5 text-xs"
                                variant={installed ? 'secondary' : 'primary'}
                                disabled={busy || installed}
                                onClick={() => void runInstall(
                                  () => installProjectSkillFromMarketplace(projectId, packageName, { provider }),
                                  packageName,
                                )}
                              >
                                {installed ? copy.marketplaceInstalled : installing ? copy.installing : copy.install}
                              </Button>
                            </div>
                          </div>
                        </article>
                      );
                    })}
                  </div>
                ) : !marketplaceLoading ? <p className="mt-6 text-center text-sm text-fg-muted">{copy.marketplaceEmpty}</p> : null}
                {marketplacePayload && marketplacePayload.meta.totalPages > 1 ? (
                  <div className="mt-3 flex items-center justify-between border-t border-edge-subtle pt-3">
                    <span className="text-xs text-fg-muted">{copy.marketplacePage.replace('{{page}}', String(marketplacePayload.meta.page)).replace('{{total}}', String(marketplacePayload.meta.totalPages))}</span>
                    <div className="flex gap-2">
                      <Button type="button" variant="ghost" className="h-8 px-2 text-xs" disabled={marketplaceLoading || marketplacePage <= 1} onClick={() => setMarketplacePage((page) => Math.max(1, page - 1))}><ChevronLeft className="size-4" />{copy.marketplacePrevious}</Button>
                      <Button type="button" variant="ghost" className="h-8 px-2 text-xs" disabled={marketplaceLoading || marketplacePage >= marketplacePayload.meta.totalPages} onClick={() => setMarketplacePage((page) => page + 1)}>{copy.marketplaceNext}<ChevronRight className="size-4" /></Button>
                    </div>
                  </div>
                ) : null}
              </section> : (
                <section className="flex h-full flex-col">
                  <p className="text-sm leading-6 text-fg-muted">{copy.sourceHint}</p>
                  <input
                    className="mt-4 h-10 w-full rounded-md border border-edge bg-surface-base px-3 text-sm outline-none focus:border-accent"
                    value={source}
                    onChange={(event) => setSource(event.target.value)}
                    placeholder={copy.sourcePlaceholder}
                    autoFocus
                  />
                  <div className="mt-auto flex justify-end gap-2 border-t border-edge pt-4">
                    <Dialog.Close asChild><Button type="button" variant="secondary">{copy.close}</Button></Dialog.Close>
                    <Button type="button" disabled={busy || !source.trim()} onClick={() => void runInstall(() => installProjectSkillFromSource(projectId, source.trim()))}>{busy ? copy.installing : copy.install}</Button>
                  </div>
                </section>
              )}
            </div>
          </Dialog.Content>
        </Dialog.Portal>
      </Dialog.Root>

      <Dialog.Root open={Boolean(preview)} onOpenChange={(open) => { if (!open) setPreview(null); }}>
        <Dialog.Portal>
          <Dialog.Overlay className="fixed inset-0 z-50 bg-black/45" />
          <Dialog.Content className="fixed left-1/2 top-1/2 z-50 flex h-[min(42rem,calc(100vh-2rem))] w-[min(48rem,calc(100vw-2rem))] -translate-x-1/2 -translate-y-1/2 flex-col overflow-hidden rounded-xl border border-edge bg-surface-panel shadow-xl">
            <div className="flex shrink-0 items-center justify-between border-b border-edge px-5 py-4"><Dialog.Title className="text-base font-semibold text-fg">{preview?.name}</Dialog.Title><Dialog.Close asChild><Button type="button" variant="ghost" className="size-9 p-0"><X className="size-4" /></Button></Dialog.Close></div>
            <pre className="min-h-0 flex-1 overflow-auto whitespace-pre-wrap p-5 text-sm leading-6 text-fg-muted">{preview?.bodyMarkdown}</pre>
          </Dialog.Content>
        </Dialog.Portal>
      </Dialog.Root>
    </section>
  );
}

function SkillSection({
  title,
  hint,
  items,
  copy,
  busy,
  availabilityByName,
  onPreview,
  onRemove,
}: {
  title: string;
  hint?: string;
  items: ProjectSkill[];
  copy: Copy;
  busy: boolean;
  availabilityByName: Map<string, ChatSkillsPayload['skills'][number]>;
  onPreview: (skillKey: string) => Promise<void>;
  onRemove: (skill: ProjectSkill) => Promise<void>;
}) {
  return (
    <section className="grid gap-3">
      <div>
        <h3 className="text-sm font-semibold text-fg">{title}</h3>
        {hint ? <p className="mt-1 text-xs leading-5 text-fg-muted">{hint}</p> : null}
      </div>
      <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
        {items.map((skill) => {
          const availability = skill.effective ? availabilityByName.get(skill.name) : undefined;
          return (
            <article key={skill.key} className={cn(
              'flex min-h-36 flex-col rounded-lg border border-edge bg-surface-panel p-4',
              !skill.effective && 'opacity-70',
            )}>
              <div className="flex items-center gap-2">
                <Archive className="size-4 text-accent-fg" aria-hidden />
                <h4 className="min-w-0 truncate text-sm font-semibold text-fg">{skill.name}</h4>
              </div>
              <p className="mt-2 line-clamp-2 flex-1 text-sm leading-5 text-fg-muted">{skill.description || skill.directoryId}</p>
              <div className="mt-2 flex flex-wrap gap-1.5 text-[11px] text-fg-subtle">
                <span className="rounded-md bg-surface-hover/70 px-2 py-0.5">{skillOriginLabel(copy, skill.origin)}</span>
                {!skill.writable ? <span className="rounded-md bg-surface-hover/70 px-2 py-0.5">{copy.sourceReadOnly}</span> : null}
                {!skill.effective ? (
                  <span className="rounded-md bg-amber-500/10 px-2 py-0.5 text-amber-800 dark:text-amber-200">{copy.shadowed}</span>
                ) : null}
                {availability ? (
                  <span className={cn(
                    'rounded-md px-2 py-0.5',
                    availability.availableForCurrentAgent
                      ? 'bg-emerald-500/10 text-emerald-700 dark:text-emerald-300'
                      : 'bg-amber-500/10 text-amber-800 dark:text-amber-200',
                  )}>
                    {availabilityLabel(copy, availability)}
                  </span>
                ) : null}
              </div>
              <div className="mt-3 flex items-center justify-between gap-2">
                <Button type="button" variant="ghost" className="h-8 px-2 text-xs" onClick={() => void onPreview(skill.key)}>
                  <ExternalLink className="size-3.5" aria-hidden />{copy.view}
                </Button>
                {skill.removable ? (
                  <Button type="button" variant="ghost" className="h-8 px-2 text-xs text-red-600" disabled={busy} onClick={() => void onRemove(skill)}>
                    <Trash2 className="size-3.5" aria-hidden />{copy.remove}
                  </Button>
                ) : null}
              </div>
            </article>
          );
        })}
      </div>
    </section>
  );
}

function skillOriginLabel(copy: Copy, origin: ProjectSkill['origin']): string {
  switch (origin) {
    case 'xopc-workspace': return copy.xopcSource;
    case 'agents-workspace': return copy.agentsSource;
    case 'xopc-global':
    case 'custom-global': return copy.globalXopcSource;
    case 'agents-global': return copy.globalAgentsSource;
    case 'bundled': return copy.bundledSource;
    case 'extra': return copy.extraSource;
  }
}

function availabilityLabel(copy: Copy, skill: ChatSkillsPayload['skills'][number]): string {
  if (skill.availableForCurrentAgent) return copy.sessionAvailable;
  switch (skill.unavailableReason) {
    case 'agent-denied': return copy.sessionUnavailableAgent;
    case 'disabled': return copy.sessionUnavailableDisabled;
    case 'requirements-unmet': return copy.sessionUnavailableRequirements;
    case 'model-invocation-disabled': return copy.sessionUnavailableModel;
    case 'tool-gated': return copy.sessionUnavailableTools;
    default: return copy.sessionUnavailableAgent;
  }
}

function InstallEntry({ icon: Icon, title, hint, onClick }: { icon: LucideIcon; title: string; hint: string; onClick: () => void }) {
  return (
    <Popover.Close asChild>
      <button type="button" className="flex w-full items-start gap-3 rounded-md px-3 py-2.5 text-left hover:bg-surface-hover" onClick={onClick}>
        <Icon className="mt-0.5 size-4 shrink-0 text-accent-fg" aria-hidden />
        <span className="min-w-0">
          <span className="block text-sm font-medium text-fg">{title}</span>
          <span className="mt-0.5 block text-xs leading-5 text-fg-muted">{hint}</span>
        </span>
      </button>
    </Popover.Close>
  );
}

function sourceStateLabel(copy: Copy, state: ProjectSkillSource['state']): string {
  switch (state) {
    case 'active': return copy.sourceStateActive;
    case 'missing': return copy.sourceStateMissing;
    case 'disabled': return copy.sourceStateDisabled;
    case 'untrusted': return copy.sourceStateUntrusted;
    case 'invalid': return copy.sourceStateInvalid;
  }
}
