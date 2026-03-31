import * as Dialog from '@radix-ui/react-dialog';
import * as DropdownMenu from '@radix-ui/react-dropdown-menu';
import {
  ChevronDown,
  FileArchive,
  Funnel,
  Info,
  MoreVertical,
  Plus,
  RefreshCw,
  Search,
  Trash2,
  X,
} from 'lucide-react';
import { useCallback, useEffect, useMemo, useState } from 'react';
import { useSearchParams } from 'react-router-dom';

import { MarkdownView } from '@/components/markdown/markdown-view';
import { Button } from '@/components/ui/button';
import { cn } from '@/lib/cn';
import { interaction } from '@/lib/interaction';
import {
  deleteSkill,
  getSkillMarkdown,
  getSkills,
  patchSkillEnabled,
  reloadSkills,
  uploadSkillZip,
} from '@/features/skills/skill-api';
import type { SkillCatalogEntry } from '@/features/skills/skill.types';
import { messages } from '@/i18n/messages';
import { useGatewayStore } from '@/stores/gateway-store';
import { useLocaleStore } from '@/stores/locale-store';

function interpolate(template: string, params: Record<string, string | number>): string {
  return template.replace(/\{\{(\w+)\}\}/g, (_, key) => String(params[key] ?? ''));
}

function hashHue(name: string): number {
  let h = 0;
  for (let i = 0; i < name.length; i++) {
    h = (h * 31 + name.charCodeAt(i)) | 0;
  }
  return Math.abs(h) % 360;
}

function SkillCardIcon({ name }: { name: string }) {
  const h = hashHue(name);
  const letter = name[0]?.toUpperCase() ?? '?';
  return (
    <div
      className="flex size-11 shrink-0 items-center justify-center rounded-xl text-sm font-semibold text-white shadow-sm"
      style={{
        background: `linear-gradient(135deg, hsl(${h}, 58%, 42%), hsl(${(h + 40) % 360}, 52%, 32%))`,
      }}
      aria-hidden
    >
      {letter}
    </div>
  );
}

type MainTab = 'builtin' | 'user' | 'marketplace';
type SourceFilter = 'all' | 'global' | 'workspace' | 'extra';
const MAIN_TAB_SET = new Set<MainTab>(['builtin', 'user', 'marketplace']);
const SOURCE_FILTER_SET = new Set<SourceFilter>(['all', 'global', 'workspace', 'extra']);

function normalizeCatalogEntry(r: SkillCatalogEntry): SkillCatalogEntry {
  return {
    ...r,
    enabled: r.enabled ?? true,
    disableModelInvocation: r.disableModelInvocation ?? false,
  };
}

function SkillEnableSwitch({
  checked,
  busy,
  onChange,
}: {
  checked: boolean;
  busy?: boolean;
  onChange: (next: boolean) => void;
}) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={checked}
      aria-busy={busy}
      disabled={busy}
      className={cn(
        'relative h-7 w-12 shrink-0 rounded-full transition-colors',
        'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent/40',
        checked ? 'bg-emerald-500' : 'bg-surface-active',
        busy && 'cursor-not-allowed opacity-60',
      )}
      onClick={() => {
        if (busy) return;
        onChange(!checked);
      }}
    >
      <span
        className={cn(
          'pointer-events-none absolute left-0.5 top-0.5 block h-6 w-6 rounded-full bg-white shadow transition-transform',
          checked ? 'translate-x-[1.375rem]' : 'translate-x-0',
        )}
      />
    </button>
  );
}

async function fileToZipUpload(file: File): Promise<File> {
  const lower = file.name.toLowerCase();
  if (lower.endsWith('.zip')) return file;
  if (lower.endsWith('skill.md')) {
    const JSZip = (await import('jszip')).default;
    const zip = new JSZip();
    zip.file('SKILL.md', await file.arrayBuffer());
    const blob = await zip.generateAsync({ type: 'blob', compression: 'DEFLATE' });
    const base = file.name.replace(/\.md$/i, '').replace(/\s+/g, '-') || 'skill';
    return new File([blob], `${base}.zip`, { type: 'application/zip' });
  }
  throw new Error('invalid');
}

const SKILL_LIST_SKELETON_COUNT = 6;

function SkillListRowSkeleton() {
  const skel =
    'animate-pulse motion-reduce:animate-none rounded-md bg-surface-hover dark:bg-surface-active/50';
  return (
    <div className="flex items-center gap-4 px-4 py-3.5" aria-hidden>
      <div className={cn('size-11 shrink-0 rounded-xl', skel)} />
      <div className="min-w-0 flex-1 space-y-2">
        <div className={cn('h-4 max-w-[10rem]', skel)} />
        <div className={cn('h-3 w-full max-w-xl rounded', skel)} />
      </div>
      <div className={cn('h-7 w-12 shrink-0 rounded-full', skel)} />
    </div>
  );
}

export function SkillsPage() {
  const language = useLocaleStore((s) => s.language);
  const m = messages(language);
  const sk = m.skills;
  const token = useGatewayStore((st) => st.token);
  const hasToken = Boolean(token);
  const [searchParams, setSearchParams] = useSearchParams();

  const [catalog, setCatalog] = useState<SkillCatalogEntry[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [uploading, setUploading] = useState(false);
  const initialSearch = searchParams.get('q') ?? '';
  const initialTabRaw = searchParams.get('tab');
  const initialSourceRaw = searchParams.get('source');
  const initialTab: MainTab = MAIN_TAB_SET.has(initialTabRaw as MainTab)
    ? (initialTabRaw as MainTab)
    : 'builtin';
  const initialSourceFilter: SourceFilter = SOURCE_FILTER_SET.has(initialSourceRaw as SourceFilter)
    ? (initialSourceRaw as SourceFilter)
    : 'all';

  const [searchQuery, setSearchQuery] = useState(initialSearch);
  const [actionFeedback, setActionFeedback] = useState<{
    kind: 'success' | 'error';
    message: string;
  } | null>(null);

  const [mainTab, setMainTab] = useState<MainTab>(initialTab);
  const [sourceFilter, setSourceFilter] = useState<SourceFilter>(initialSourceFilter);

  const [installOpen, setInstallOpen] = useState(false);
  const [pendingFile, setPendingFile] = useState<File | null>(null);
  const [dropActive, setDropActive] = useState(false);

  const [confirmOpen, setConfirmOpen] = useState(false);
  const [confirmId, setConfirmId] = useState<string | null>(null);
  const [togglingSkillName, setTogglingSkillName] = useState<string | null>(null);

  const [detailOpen, setDetailOpen] = useState(false);
  const [detailTitle, setDetailTitle] = useState('');
  const [detailMarkdown, setDetailMarkdown] = useState('');
  const [detailLoading, setDetailLoading] = useState(false);
  const [detailError, setDetailError] = useState<string | null>(null);

  const load = useCallback(
    async (opts?: { silent?: boolean }): Promise<{ ok: true } | { ok: false; message: string }> => {
      const silent = opts?.silent === true;
      if (!silent) {
        setLoading(true);
      }
      setError(null);
      try {
        const data = await getSkills();
        setCatalog(data.catalog.map(normalizeCatalogEntry));
        return { ok: true };
      } catch (e) {
        const message = e instanceof Error ? e.message : sk.loadFailed;
        setError(message);
        return { ok: false, message };
      } finally {
        if (!silent) {
          setLoading(false);
        }
      }
    },
    [sk.loadFailed],
  );

  useEffect(() => {
    if (!hasToken) return;
    void load();
  }, [hasToken, load]);

  useEffect(() => {
    const nextQ = searchParams.get('q') ?? '';
    const nextTabRaw = searchParams.get('tab');
    const nextSourceRaw = searchParams.get('source');
    const nextTab: MainTab = MAIN_TAB_SET.has(nextTabRaw as MainTab)
      ? (nextTabRaw as MainTab)
      : 'builtin';
    const nextSource: SourceFilter = SOURCE_FILTER_SET.has(nextSourceRaw as SourceFilter)
      ? (nextSourceRaw as SourceFilter)
      : 'all';
    setSearchQuery((prev) => (prev === nextQ ? prev : nextQ));
    setMainTab((prev) => (prev === nextTab ? prev : nextTab));
    setSourceFilter((prev) => (prev === nextSource ? prev : nextSource));
  }, [searchParams]);

  useEffect(() => {
    const params = new URLSearchParams(searchParams);
    const nextQ = searchQuery.trim();
    if (nextQ) params.set('q', nextQ);
    else params.delete('q');
    if (mainTab !== 'builtin') params.set('tab', mainTab);
    else params.delete('tab');
    if (sourceFilter !== 'all') params.set('source', sourceFilter);
    else params.delete('source');
    const next = params.toString();
    if (next !== searchParams.toString()) {
      setSearchParams(params, { replace: true });
    }
  }, [mainTab, searchParams, searchQuery, setSearchParams, sourceFilter]);

  const showFeedback = useCallback((kind: 'success' | 'error', message: string, durationMs = 5000) => {
    setActionFeedback({ kind, message });
    window.setTimeout(() => setActionFeedback(null), durationMs);
  }, []);

  const openSkillDetail = useCallback(
    async (row: SkillCatalogEntry) => {
      setDetailOpen(true);
      setDetailTitle(row.name);
      setDetailMarkdown('');
      setDetailError(null);
      setDetailLoading(true);
      try {
        const { markdown, name } = await getSkillMarkdown(row.name);
        setDetailMarkdown(markdown);
        setDetailTitle(name);
      } catch (e) {
        setDetailError(e instanceof Error ? e.message : sk.detailLoadFailed);
      } finally {
        setDetailLoading(false);
      }
    },
    [sk.detailLoadFailed],
  );

  const onSkillToggle = useCallback(
    async (name: string, next: boolean): Promise<boolean> => {
      setTogglingSkillName(name);
      setActionFeedback(null);
      try {
        await patchSkillEnabled(name, next);
        await load({ silent: true });
        return true;
      } catch (e) {
        const msg = e instanceof Error ? e.message : sk.skillToggleFailed;
        showFeedback('error', msg);
        return false;
      } finally {
        setTogglingSkillName(null);
      }
    },
    [load, showFeedback, sk.skillToggleFailed],
  );

  const onReloadClick = async () => {
    setActionFeedback(null);
    setLoading(true);
    setError(null);
    try {
      await reloadSkills();
    } catch (e) {
      const msg = e instanceof Error ? e.message : sk.reloadFailed;
      setError(msg);
      setLoading(false);
      return;
    }
    await load();
  };

  const builtinTabStats = useMemo(() => {
    const rows = catalog.filter((r) => r.source === 'builtin');
    return {
      total: rows.length,
      enabled: rows.filter((r) => r.enabled).length,
    };
  }, [catalog]);

  const userTabStats = useMemo(() => {
    const rows = catalog.filter((r) => r.source !== 'builtin');
    return {
      total: rows.length,
      enabled: rows.filter((r) => r.enabled).length,
    };
  }, [catalog]);

  const detailFromCatalog = useMemo(
    () => (detailTitle ? catalog.find((r) => r.name === detailTitle) : undefined),
    [catalog, detailTitle],
  );
  const detailEnabled = detailFromCatalog?.enabled ?? true;

  const filteredCatalog = useMemo(() => {
    if (mainTab === 'marketplace') {
      return [];
    }
    const q = searchQuery.trim().toLowerCase();
    let rows = catalog;

    if (mainTab === 'builtin') {
      rows = rows.filter((r) => r.source === 'builtin');
    } else {
      rows = rows.filter((r) => r.source !== 'builtin');
      if (sourceFilter !== 'all') {
        rows = rows.filter((r) => r.source === sourceFilter);
      }
    }

    if (!q) return rows;
    return rows.filter((row) => {
      const blob = [row.name, row.description, row.directoryId, row.path, row.source]
        .filter(Boolean)
        .join(' ')
        .toLowerCase();
      return blob.includes(q);
    });
  }, [catalog, searchQuery, mainTab, sourceFilter]);

  const runUpload = async (file: File) => {
    setActionFeedback(null);
    setUploading(true);
    setError(null);
    try {
      let upload: File;
      try {
        upload = await fileToZipUpload(file);
      } catch {
        setError(sk.invalidFile);
        showFeedback('error', sk.invalidFile);
        return;
      }
      await uploadSkillZip(upload, { overwrite: true });
      await load();
      showFeedback('success', sk.installSuccess);
      setInstallOpen(false);
      setPendingFile(null);
      setMainTab('user');
    } catch (err) {
      setError(err instanceof Error ? err.message : sk.uploadFailed);
      showFeedback('error', err instanceof Error ? err.message : sk.uploadFailed);
    } finally {
      setUploading(false);
    }
  };

  const onInstallSubmit = () => {
    if (pendingFile) void runUpload(pendingFile);
  };

  const onFileInputChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    e.target.value = '';
    if (file) setPendingFile(file);
  };

  const onModalDragOver = (e: React.DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
    if (e.dataTransfer.types.includes('Files')) {
      setDropActive(true);
      e.dataTransfer.dropEffect = 'copy';
    }
  };

  const onModalDragLeave = (e: React.DragEvent) => {
    const root = e.currentTarget as HTMLElement;
    const to = e.relatedTarget as Node | null;
    if (to && root.contains(to)) return;
    setDropActive(false);
  };

  const onModalDrop = (e: React.DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
    setDropActive(false);
    const file = e.dataTransfer?.files?.[0];
    if (file) setPendingFile(file);
  };

  const sourceLabel = (source: SkillCatalogEntry['source']): string => {
    switch (source) {
      case 'builtin':
        return sk.source.builtin;
      case 'workspace':
        return sk.source.workspace;
      case 'global':
        return sk.source.global;
      case 'extra':
        return sk.source.extra;
      default:
        return source;
    }
  };

  const runDelete = async () => {
    const id = confirmId;
    setConfirmOpen(false);
    setConfirmId(null);
    if (!id) return;
    setActionFeedback(null);
    try {
      await deleteSkill(id);
      await load();
    } catch (e) {
      setError(e instanceof Error ? e.message : sk.deleteFailed);
    }
  };

  const filterLabel =
    sourceFilter === 'all'
      ? sk.filterAll
      : sourceFilter === 'global'
        ? sk.filterGlobal
        : sourceFilter === 'workspace'
          ? sk.filterWorkspace
          : sk.filterExtra;

  if (!hasToken) {
    return (
      <div className="mx-auto w-full max-w-app-main px-4 py-16 text-center text-sm text-fg-muted sm:px-8">
        {sk.needToken}
      </div>
    );
  }

  return (
    <div className="flex min-h-0 flex-1 flex-col overflow-y-auto bg-surface-panel">
      <div className="mx-auto flex w-full max-w-app-main flex-col gap-6 px-4 py-6 sm:px-8">
        {actionFeedback ? (
          <div
            role="status"
            aria-live="polite"
            className={cn(
              'rounded-xl border px-3 py-2 text-sm',
              actionFeedback.kind === 'success'
                ? 'border-emerald-200 bg-emerald-50 text-emerald-800 dark:border-emerald-900/40 dark:bg-emerald-950/40 dark:text-emerald-200'
                : 'border-red-200 bg-red-50 text-red-800 dark:border-red-900/50 dark:bg-red-950/40 dark:text-red-200',
            )}
          >
            {actionFeedback.message}
          </div>
        ) : error ? (
          <div
            className="rounded-xl border border-edge bg-red-50 px-3 py-2 text-sm text-red-700 dark:border-edge dark:bg-red-950/40 dark:text-red-300"
            role="alert"
          >
            {error}
          </div>
        ) : null}

        <header className="flex flex-col gap-4">
          <div className="flex w-full shrink-0 flex-wrap items-center justify-end gap-2 sm:flex-nowrap">
            <Button
              type="button"
              variant="ghost"
              className="h-9 w-9 shrink-0 p-0"
              disabled={loading}
              title={sk.reloadRuntime}
              aria-label={sk.reloadDiskAria}
              onClick={() => void onReloadClick()}
            >
              <RefreshCw className={cn('size-4', loading && 'animate-spin')} strokeWidth={1.75} />
            </Button>
            <label className="relative flex min-h-9 min-w-0 max-w-sm cursor-text items-center rounded-pill border border-edge bg-surface-base py-1.5 pl-9 pr-3 shadow-sm dark:bg-surface-hover/40 sm:max-w-md">
              <Search
                className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-fg-disabled"
                strokeWidth={1.75}
                aria-hidden
              />
              <input
                type="text"
                role="searchbox"
                enterKeyHint="search"
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                placeholder={sk.searchPlaceholder}
                autoComplete="off"
                spellCheck={false}
                className="min-w-0 flex-1 appearance-none border-0 bg-transparent py-0.5 text-sm leading-normal text-fg caret-current placeholder:text-fg-disabled focus:border-0 focus:shadow-none focus:outline-none focus:ring-0 focus-visible:outline-none"
              />
            </label>
            <Button
              type="button"
              variant="primary"
              className="shrink-0 gap-2"
              onClick={() => {
                setPendingFile(null);
                setInstallOpen(true);
              }}
            >
              <Plus className="size-4" strokeWidth={1.75} aria-hidden />
              {sk.installCta}
            </Button>
          </div>
          <div className="min-w-0">
            <h1 className="text-xl font-semibold tracking-tight text-fg">{sk.title}</h1>
            <p className="mt-1 max-w-2xl text-sm text-fg-muted">{sk.tagline}</p>
          </div>
        </header>

        <section className="flex flex-col gap-4">
          <div className="flex flex-col gap-3 border-b border-edge-subtle pb-3 sm:flex-row sm:items-center sm:justify-between dark:border-edge-subtle">
            <div className="flex gap-1" role="tablist" aria-label={sk.skillsNavAria}>
              <button
                type="button"
                role="tab"
                aria-selected={mainTab === 'builtin'}
                className={cn(
                  'rounded-md px-3 py-2 text-sm font-medium transition-colors',
                  mainTab === 'builtin' ? 'text-fg' : 'text-fg-muted hover:text-fg',
                )}
                onClick={() => setMainTab('builtin')}
              >
                {sk.tabBuiltin}
                <span className="ml-1 tabular-nums text-fg-muted">
                  ({builtinTabStats.enabled}/{builtinTabStats.total})
                </span>
              </button>
              <button
                type="button"
                role="tab"
                aria-selected={mainTab === 'user'}
                className={cn(
                  'rounded-md px-3 py-2 text-sm font-medium transition-colors',
                  mainTab === 'user' ? 'text-fg' : 'text-fg-muted hover:text-fg',
                )}
                onClick={() => setMainTab('user')}
              >
                {sk.tabUser}
                <span className="ml-1 tabular-nums text-fg-muted">
                  ({userTabStats.enabled}/{userTabStats.total})
                </span>
              </button>
              <button
                type="button"
                role="tab"
                aria-selected={mainTab === 'marketplace'}
                className={cn(
                  'rounded-md px-3 py-2 text-sm font-medium transition-colors',
                  mainTab === 'marketplace' ? 'text-fg' : 'text-fg-muted hover:text-fg',
                )}
                onClick={() => setMainTab('marketplace')}
              >
                {sk.tabMarketplace}
              </button>
            </div>
            <div
              className={cn(
                'flex min-w-0 items-center gap-2',
                mainTab === 'user'
                  ? 'flex-nowrap overflow-x-auto pb-0.5 sm:justify-end'
                  : 'flex-wrap sm:justify-end',
              )}
            >
              {mainTab === 'user' ? (
                <DropdownMenu.Root>
                  <DropdownMenu.Trigger asChild>
                    <button
                      type="button"
                      className={cn(
                        'inline-flex h-9 min-h-9 min-w-[9rem] shrink-0 items-center gap-1.5 rounded-lg border border-edge bg-surface-panel px-2.5 text-xs font-medium text-fg shadow-sm',
                        interaction.transition,
                        interaction.focusRingPanel,
                      )}
                    >
                      <Funnel className="size-3.5 text-fg-muted" strokeWidth={1.75} aria-hidden />
                      <span>{filterLabel}</span>
                      <ChevronDown className="size-3.5 text-fg-subtle" strokeWidth={1.75} aria-hidden />
                    </button>
                  </DropdownMenu.Trigger>
                  <DropdownMenu.Portal>
                    <DropdownMenu.Content
                      className="z-50 min-w-[10rem] rounded-xl border border-edge bg-surface-panel p-1 shadow-popover dark:border-edge"
                      sideOffset={6}
                      align="end"
                    >
                      {(['all', 'global', 'workspace', 'extra'] as const).map((key) => (
                        <DropdownMenu.Item
                          key={key}
                          className={cn(
                            'cursor-pointer rounded-lg px-3 py-2 text-sm text-fg outline-none',
                            'hover:bg-surface-hover data-[highlighted]:bg-surface-hover',
                          )}
                          onSelect={() => setSourceFilter(key)}
                        >
                          {key === 'all'
                            ? sk.filterAll
                            : key === 'global'
                              ? sk.filterGlobal
                              : key === 'workspace'
                                ? sk.filterWorkspace
                                : sk.filterExtra}
                        </DropdownMenu.Item>
                      ))}
                    </DropdownMenu.Content>
                  </DropdownMenu.Portal>
                </DropdownMenu.Root>
              ) : null}
            </div>
          </div>

          {mainTab === 'marketplace' ? (
            <div className="rounded-2xl border border-dashed border-edge bg-surface-base/40 px-6 py-16 text-center text-sm text-fg-muted">
              {sk.marketplacePlaceholder}
            </div>
          ) : (
            <>
              <p className="text-xs font-medium uppercase tracking-wide text-fg-subtle">
                {mainTab === 'builtin' ? sk.sectionBuiltinList : sk.sectionUser}
              </p>

              {loading ? (
                <div
                  className="overflow-hidden rounded-2xl border border-edge-subtle bg-surface-base dark:border-edge-subtle"
                  aria-busy="true"
                  aria-label={sk.loading}
                >
                  {Array.from({ length: SKILL_LIST_SKELETON_COUNT }, (_, i) => (
                    <SkillListRowSkeleton key={i} />
                  ))}
                </div>
              ) : catalog.length === 0 ? (
                <div className="rounded-2xl border border-dashed border-edge py-16 text-center text-sm text-fg-muted">
                  {sk.empty}
                </div>
              ) : filteredCatalog.length === 0 ? (
                <div className="rounded-2xl border border-dashed border-edge py-16 text-center text-sm text-fg-muted">
                  {sk.noSearchResults}
                </div>
              ) : (
                <div className="overflow-hidden rounded-2xl border border-edge-subtle bg-surface-base dark:border-edge-subtle">
                  {filteredCatalog.map((row) => (
                    <article
                      key={`${row.directoryId}-${row.path}`}
                      className="group relative flex items-center gap-4 border-b border-edge-subtle px-4 py-3.5 last:border-b-0"
                    >
                      <button
                        type="button"
                        className={cn(
                          'flex min-w-0 flex-1 cursor-pointer items-center gap-4 rounded-lg text-left outline-none',
                          'hover:bg-surface-hover/50 dark:hover:bg-surface-hover/30',
                          interaction.focusRingPanel,
                        )}
                        onClick={() => void openSkillDetail(row)}
                      >
                        <SkillCardIcon name={row.name} />
                        <div className="min-w-0 flex-1 pr-2">
                          <h3 className="font-semibold leading-snug text-fg">{row.name}</h3>
                          <p className="mt-0.5 line-clamp-2 text-sm leading-relaxed text-fg-muted">
                            {row.description || '—'}
                          </p>
                          <div className="mt-1.5 flex flex-wrap gap-1.5 text-[11px] text-fg-subtle">
                            <span className="rounded-md bg-surface-hover/60 px-2 py-0.5 dark:bg-surface-active/50">
                              {sourceLabel(row.source)}
                            </span>
                            {row.managed ? (
                              <span className="rounded-md bg-surface-hover/60 px-2 py-0.5 dark:bg-surface-active/50">
                                {sk.col.managed}: {sk.yes}
                              </span>
                            ) : null}
                          </div>
                        </div>
                      </button>
                      <div
                        className="flex shrink-0 items-center gap-1"
                        onClick={(e) => e.stopPropagation()}
                        role="presentation"
                      >
                        {row.managed ? (
                          <DropdownMenu.Root>
                            <DropdownMenu.Trigger asChild>
                              <button
                                type="button"
                                className={cn(
                                  'flex size-9 items-center justify-center rounded-lg text-fg-muted hover:bg-surface-hover hover:text-fg',
                                  interaction.focusRingPanel,
                                )}
                                aria-label={sk.col.actions}
                              >
                                <MoreVertical className="size-4" strokeWidth={1.75} />
                              </button>
                            </DropdownMenu.Trigger>
                            <DropdownMenu.Portal>
                              <DropdownMenu.Content
                                className="z-50 min-w-[8rem] rounded-xl border border-edge bg-surface-panel p-1 shadow-popover dark:border-edge"
                                sideOffset={4}
                                align="end"
                              >
                                <DropdownMenu.Item
                                  className={cn(
                                    'flex cursor-pointer items-center gap-2 rounded-lg px-3 py-2 text-sm text-red-600 outline-none',
                                    'hover:bg-red-50 data-[highlighted]:bg-red-50 dark:text-red-400 dark:hover:bg-red-950/40',
                                  )}
                                  onSelect={() => {
                                    setConfirmId(row.directoryId);
                                    setConfirmOpen(true);
                                  }}
                                >
                                  <Trash2 className="size-4" strokeWidth={1.75} aria-hidden />
                                  {sk.delete}
                                </DropdownMenu.Item>
                              </DropdownMenu.Content>
                            </DropdownMenu.Portal>
                          </DropdownMenu.Root>
                        ) : null}
                        <SkillEnableSwitch
                          checked={row.enabled}
                          busy={togglingSkillName === row.name}
                          onChange={(next) => void onSkillToggle(row.name, next)}
                        />
                      </div>
                    </article>
                  ))}
                </div>
              )}
            </>
          )}
        </section>
      </div>

      {/* SKILL.md preview */}
      <Dialog.Root
        open={detailOpen}
        onOpenChange={(open) => {
          setDetailOpen(open);
          if (!open) {
            setDetailMarkdown('');
            setDetailError(null);
            setDetailTitle('');
          }
        }}
      >
        <Dialog.Portal>
          <Dialog.Overlay className="xopcbot-dialog-overlay fixed inset-0 z-[60] bg-scrim" />
          <Dialog.Content
            className={cn(
              'xopcbot-dialog-content fixed left-1/2 top-1/2 z-[60] flex max-h-[min(90vh,56rem)] w-[min(100%-2rem,min(92vw,56rem))] -translate-x-1/2 -translate-y-1/2 flex-col',
              'rounded-2xl border border-edge bg-surface-panel shadow-float dark:border-edge',
            )}
          >
            <div className="flex shrink-0 items-center gap-3 border-b border-edge px-4 py-3">
              <SkillCardIcon name={detailTitle || '?'} />
              <Dialog.Title className="min-w-0 flex-1 truncate text-base font-semibold text-fg">
                {detailTitle || '—'}
              </Dialog.Title>
              <Dialog.Close asChild>
                <button
                  type="button"
                  className={cn(
                    'rounded-lg p-1.5 text-fg-muted hover:bg-surface-hover hover:text-fg',
                    interaction.focusRingPanel,
                  )}
                  aria-label={sk.detailCloseAria}
                >
                  <X className="size-5" strokeWidth={1.75} aria-hidden />
                </button>
              </Dialog.Close>
            </div>
            <div className="flex shrink-0 items-start gap-2 border-b border-blue-200/80 bg-blue-50/95 px-4 py-2.5 text-sm text-fg dark:border-blue-900/50 dark:bg-blue-950/45">
              <Info className="mt-0.5 size-4 shrink-0 text-blue-600 dark:text-blue-400" strokeWidth={1.75} aria-hidden />
              <p className="leading-relaxed">{sk.detailModalBanner}</p>
            </div>
            <div className="min-h-0 flex-1 overflow-y-auto px-4 py-4">
              {detailLoading ? (
                <div className="space-y-2" aria-busy="true">
                  <div className="h-4 w-2/3 animate-pulse rounded bg-surface-hover" />
                  <div className="h-4 w-full animate-pulse rounded bg-surface-hover" />
                  <div className="h-4 w-5/6 animate-pulse rounded bg-surface-hover" />
                </div>
              ) : detailError ? (
                <p className="text-sm text-red-600 dark:text-red-400">{detailError}</p>
              ) : (
                <div className="markdown-content min-w-0">
                  <MarkdownView content={detailMarkdown} />
                </div>
              )}
            </div>
            <div className="flex shrink-0 justify-end border-t border-edge px-4 py-3">
              <Button
                type="button"
                variant="primary"
                disabled={!detailTitle || togglingSkillName === detailTitle}
                onClick={async () => {
                  if (!detailTitle) return;
                  const ok = await onSkillToggle(detailTitle, !detailEnabled);
                  if (ok) setDetailOpen(false);
                }}
              >
                {detailEnabled ? sk.detailModalDisable : sk.detailModalEnable}
              </Button>
            </div>
          </Dialog.Content>
        </Dialog.Portal>
      </Dialog.Root>

      {/* Install modal */}
      <Dialog.Root
        open={installOpen}
        onOpenChange={(open) => {
          setInstallOpen(open);
          if (!open) {
            setPendingFile(null);
            setDropActive(false);
          }
        }}
      >
        <Dialog.Portal>
          <Dialog.Overlay className="xopcbot-dialog-overlay fixed inset-0 z-[60] bg-scrim" />
          <Dialog.Content
            className={cn(
              'xopcbot-dialog-content fixed left-1/2 top-1/2 z-[60] max-h-[min(100vh-2rem,44rem)] w-[min(100%-2rem,min(92vw,48rem))] -translate-x-1/2 -translate-y-1/2 overflow-y-auto',
              'rounded-2xl border border-edge bg-surface-panel p-6 shadow-float dark:border-edge',
            )}
          >
            <div className="flex items-start justify-between gap-3">
              <Dialog.Title className="text-base font-semibold text-fg">{sk.installModalTitle}</Dialog.Title>
              <Dialog.Close asChild>
                <button
                  type="button"
                  className={cn(
                    'rounded-lg p-1.5 text-fg-muted hover:bg-surface-hover hover:text-fg',
                    interaction.focusRingPanel,
                  )}
                  aria-label={sk.installClose}
                >
                  <X className="size-5" strokeWidth={1.75} aria-hidden />
                  <span className="sr-only">{sk.installClose}</span>
                </button>
              </Dialog.Close>
            </div>

            <label
              className={cn(
                'mt-4 flex min-h-[11rem] cursor-pointer flex-col items-center justify-center gap-3 rounded-xl border-2 border-dashed px-6 py-12 text-center transition-colors',
                dropActive
                  ? 'border-accent bg-accent-soft/60 dark:bg-blue-950/40'
                  : 'border-edge bg-surface-base dark:bg-surface-hover/30',
              )}
              onDragLeave={onModalDragLeave}
              onDragOver={onModalDragOver}
              onDrop={onModalDrop}
            >
              <input
                type="file"
                accept=".zip,.md,application/zip,text/markdown"
                className="sr-only"
                aria-label={sk.installModalDropHint}
                disabled={uploading}
                onChange={onFileInputChange}
              />
              <FileArchive className="size-12 text-fg-subtle" strokeWidth={1.25} aria-hidden />
              <span className="text-sm text-fg-muted">{sk.installModalDropHint}</span>
              {pendingFile ? (
                <span className="text-xs font-medium text-fg">{pendingFile.name}</span>
              ) : null}
            </label>

            <div className="mt-5 space-y-2">
              <p className="text-sm font-medium text-fg">{sk.installModalReqTitle}</p>
              <ul className="list-inside list-disc space-y-1 text-sm text-fg-muted">
                <li>{sk.installModalReq1}</li>
                <li>{sk.installModalReq2}</li>
              </ul>
            </div>

            <button
              type="button"
              disabled={!pendingFile || uploading}
              className={cn(
                'mt-6 flex w-full items-center justify-center rounded-xl py-3 text-sm font-semibold',
                'transition-colors',
                !pendingFile || uploading
                  ? 'cursor-not-allowed bg-surface-active text-fg-disabled'
                  : 'bg-[#1d1d1f] text-white hover:opacity-90 dark:bg-white dark:text-[#1d1d1f]',
                interaction.focusRingPanel,
              )}
              onClick={() => void onInstallSubmit()}
            >
              {uploading ? sk.uploading : sk.installAction}
            </button>
          </Dialog.Content>
        </Dialog.Portal>
      </Dialog.Root>

      <Dialog.Root
        open={confirmOpen}
        onOpenChange={(open) => {
          setConfirmOpen(open);
          if (!open) setConfirmId(null);
        }}
      >
        <Dialog.Portal>
          <Dialog.Overlay className="xopcbot-dialog-overlay fixed inset-0 z-[60] bg-scrim" />
          <Dialog.Content className="xopcbot-dialog-content fixed left-1/2 top-1/2 z-[60] w-[min(100%-2rem,24rem)] -translate-x-1/2 -translate-y-1/2 rounded-xl border border-edge bg-surface-panel p-4 shadow-xl dark:border-edge">
            <Dialog.Title className="text-base font-semibold text-fg">{sk.deleteTitle}</Dialog.Title>
            <p className="mt-2 text-sm text-fg-muted">
              {confirmId ? interpolate(sk.deleteMessage, { id: confirmId }) : ''}
            </p>
            <div className="mt-4 flex justify-end gap-2">
              <Button type="button" variant="secondary" onClick={() => setConfirmOpen(false)}>
                {sk.cancel}
              </Button>
              <Button
                type="button"
                variant="primary"
                className="bg-red-600 hover:bg-red-700"
                onClick={() => void runDelete()}
              >
                {sk.deleteConfirm}
              </Button>
            </div>
          </Dialog.Content>
        </Dialog.Portal>
      </Dialog.Root>
    </div>
  );
}
