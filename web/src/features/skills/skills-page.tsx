import * as Dialog from '@radix-ui/react-dialog';
import * as DropdownMenu from '@radix-ui/react-dropdown-menu';
import {
  ChevronDown,
  FileArchive,
  Funnel,
  MoreVertical,
  Plus,
  RefreshCw,
  Search,
  Sparkles,
  Trash2,
  X,
} from 'lucide-react';
import { useCallback, useEffect, useMemo, useState } from 'react';

import { Button } from '@/components/ui/button';
import {
  segmentedThumbActiveClassName,
  segmentedThumbBaseClassName,
  segmentedTrackClassName,
} from '@/components/ui/segmented-styles';
import { cn } from '@/lib/cn';
import { interaction } from '@/lib/interaction';
import {
  deleteSkill,
  getSkills,
  reloadSkills,
  uploadSkillZip,
} from '@/features/skills/skill-api';
import type { SkillCatalogEntry } from '@/features/skills/skill.types';
import { messages } from '@/i18n/messages';
import { useGatewayStore } from '@/stores/gateway-store';
import { useLocaleStore } from '@/stores/locale-store';

const CREATE_SKILL_URL = 'https://cursor.com/docs';

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

type MainTab = 'builtin' | 'user';
type SourceFilter = 'all' | 'global' | 'workspace' | 'extra';

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

const SKILL_GRID_SKELETON_COUNT = 9;

function SkillCardSkeleton() {
  const skel =
    'animate-pulse motion-reduce:animate-none rounded-md bg-surface-hover dark:bg-surface-active/50';
  return (
    <div
      className="flex flex-col gap-3 rounded-xl border border-edge-subtle bg-surface-base p-4 dark:border-edge-subtle"
      aria-hidden
    >
      <div className="flex gap-3">
        <div className={cn('size-11 shrink-0 rounded-xl', skel)} />
        <div className="min-w-0 flex-1 space-y-2 pt-0.5">
          <div className={cn('h-4 max-w-[12rem]', skel)} />
          <div className={cn('h-3 w-full rounded', skel)} />
          <div className={cn('h-3 w-[80%] rounded', skel)} />
        </div>
      </div>
    </div>
  );
}

function HeroIllustration() {
  return (
    <div className="pointer-events-none hidden shrink-0 select-none sm:block" aria-hidden>
      <svg width="168" height="112" viewBox="0 0 168 112" className="text-blue-200/80 dark:text-blue-400/30">
        <defs>
          <linearGradient id="skillHeroA" x1="0%" y1="0%" x2="100%" y2="100%">
            <stop offset="0%" stopColor="rgb(147 197 253)" />
            <stop offset="100%" stopColor="rgb(96 165 250)" />
          </linearGradient>
        </defs>
        <rect x="52" y="8" width="72" height="88" rx="10" fill="url(#skillHeroA)" transform="rotate(8 88 52)" opacity="0.9" />
        <rect x="36" y="20" width="72" height="88" rx="10" fill="rgb(191 219 254)" transform="rotate(-6 72 64)" opacity="0.95" />
        <rect x="56" y="28" width="72" height="88" rx="10" fill="rgb(239 246 255)" className="dark:fill-blue-950/80" transform="rotate(4 92 72)" />
        <circle cx="92" cy="58" r="12" fill="rgb(59 130 246 / 0.35)" />
        <circle cx="108" cy="78" r="6" fill="rgb(37 99 235 / 0.4)" />
      </svg>
    </div>
  );
}

export function SkillsPage() {
  const language = useLocaleStore((s) => s.language);
  const m = messages(language);
  const sk = m.skills;
  const token = useGatewayStore((st) => st.token);
  const hasToken = Boolean(token);

  const [catalog, setCatalog] = useState<SkillCatalogEntry[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [uploading, setUploading] = useState(false);
  const [searchQuery, setSearchQuery] = useState('');
  const [actionFeedback, setActionFeedback] = useState<{
    kind: 'success' | 'error';
    message: string;
  } | null>(null);

  const [mainTab, setMainTab] = useState<MainTab>('builtin');
  const [sourceFilter, setSourceFilter] = useState<SourceFilter>('all');

  const [installOpen, setInstallOpen] = useState(false);
  const [pendingFile, setPendingFile] = useState<File | null>(null);
  const [dropActive, setDropActive] = useState(false);

  const [confirmOpen, setConfirmOpen] = useState(false);
  const [confirmId, setConfirmId] = useState<string | null>(null);

  const load = useCallback(async (): Promise<{ ok: true } | { ok: false; message: string }> => {
    setLoading(true);
    setError(null);
    try {
      const data = await getSkills();
      setCatalog(data.catalog);
      return { ok: true };
    } catch (e) {
      const message = e instanceof Error ? e.message : sk.loadFailed;
      setError(message);
      return { ok: false, message };
    } finally {
      setLoading(false);
    }
  }, [sk.loadFailed]);

  useEffect(() => {
    if (!hasToken) return;
    void load();
  }, [hasToken, load]);

  const showFeedback = useCallback((kind: 'success' | 'error', message: string, durationMs = 5000) => {
    setActionFeedback({ kind, message });
    window.setTimeout(() => setActionFeedback(null), durationMs);
  }, []);

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

  const userCount = useMemo(() => catalog.filter((r) => r.source !== 'builtin').length, [catalog]);

  const filteredCatalog = useMemo(() => {
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
          <div className="flex w-full shrink-0 flex-nowrap items-center justify-end gap-2">
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
            <Button
              type="button"
              variant="secondary"
              className="gap-2"
              onClick={() => {
                window.open(CREATE_SKILL_URL, '_blank', 'noopener,noreferrer');
              }}
            >
              <Sparkles className="size-4 text-fg-muted" strokeWidth={1.75} aria-hidden />
              {sk.createViaCursor}
            </Button>
            <Button
              type="button"
              variant="primary"
              className="gap-2"
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

        <div className="w-full min-w-0 max-w-xl">
          <label className="flex w-full items-center gap-2 rounded-pill border border-edge bg-surface-base px-4 py-2.5 shadow-sm dark:bg-surface-hover/40">
            <Search className="size-4 shrink-0 text-fg-disabled" strokeWidth={1.75} aria-hidden />
            <input
              type="search"
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              placeholder={sk.searchPlaceholder}
              autoComplete="off"
              className="min-w-0 flex-1 border-0 bg-transparent text-sm text-fg placeholder:text-fg-disabled focus:outline-none focus:ring-0"
            />
          </label>
        </div>

        {/* Featured hero */}
        <section
          className="flex flex-col gap-4 rounded-2xl border border-edge-subtle bg-blue-50/90 px-5 py-6 sm:flex-row sm:items-center sm:justify-between sm:px-8 dark:border-edge dark:bg-blue-950/35"
          aria-labelledby="skills-hero-heading"
        >
          <div className="min-w-0 flex-1 space-y-2">
            <h2 id="skills-hero-heading" className="text-base font-semibold text-fg">
              {sk.heroFeaturedTitle}
            </h2>
            <p className="text-sm leading-relaxed text-fg-muted">{sk.heroFeaturedDesc}</p>
          </div>
          <HeroIllustration />
        </section>

        {/* Marketplace */}
        <section className="flex flex-col gap-4">
          <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
            <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:gap-6">
              <h2 className="text-base font-semibold text-fg">{sk.marketplaceTitle}</h2>
              <div className={segmentedTrackClassName} role="tablist" aria-label={sk.marketplaceTitle}>
                <button
                  type="button"
                  role="tab"
                  aria-selected={mainTab === 'builtin'}
                  className={cn(
                    segmentedThumbBaseClassName,
                    'px-3 py-1.5',
                    mainTab === 'builtin' && segmentedThumbActiveClassName,
                  )}
                  onClick={() => setMainTab('builtin')}
                >
                  {sk.tabBuiltin}
                </button>
                <button
                  type="button"
                  role="tab"
                  aria-selected={mainTab === 'user'}
                  className={cn(
                    segmentedThumbBaseClassName,
                    'inline-flex items-center gap-1.5 px-3 py-1.5',
                    mainTab === 'user' && segmentedThumbActiveClassName,
                  )}
                  onClick={() => setMainTab('user')}
                >
                  {sk.tabUser}
                  <span className="rounded-md bg-surface-hover px-1.5 py-0 text-[10px] font-medium text-fg-subtle dark:bg-surface-active">
                    {userCount}
                  </span>
                </button>
              </div>
            </div>

            {mainTab === 'user' ? (
              <DropdownMenu.Root>
                <DropdownMenu.Trigger asChild>
                  <button
                    type="button"
                    className={cn(
                      'inline-flex items-center gap-2 rounded-xl border border-edge bg-surface-panel px-3 py-2 text-sm text-fg shadow-sm',
                      interaction.transition,
                      interaction.focusRingPanel,
                    )}
                  >
                    <Funnel className="size-4 text-fg-muted" strokeWidth={1.75} aria-hidden />
                    <span>{filterLabel}</span>
                    <ChevronDown className="size-4 text-fg-subtle" strokeWidth={1.75} aria-hidden />
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

          <p className="text-xs font-medium uppercase tracking-wide text-fg-subtle">
            {mainTab === 'builtin' ? sk.sectionOfficial : sk.sectionUser}
          </p>

          {loading ? (
            <div
              className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3"
              aria-busy="true"
              aria-label={sk.loading}
            >
              {Array.from({ length: SKILL_GRID_SKELETON_COUNT }, (_, i) => (
                <SkillCardSkeleton key={i} />
              ))}
            </div>
          ) : (
            <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
              {catalog.length === 0 ? (
                <div className="col-span-full rounded-2xl border border-dashed border-edge py-16 text-center text-sm text-fg-muted">
                  {sk.empty}
                </div>
              ) : filteredCatalog.length === 0 ? (
                <div className="col-span-full rounded-2xl border border-dashed border-edge py-16 text-center text-sm text-fg-muted">
                  {sk.noSearchResults}
                </div>
              ) : (
                filteredCatalog.map((row) => (
                  <article
                    key={`${row.directoryId}-${row.path}`}
                    className={cn(
                      'group relative flex flex-col gap-3 rounded-xl border border-edge-subtle bg-surface-base p-4 shadow-sm',
                      'transition-[border-color,box-shadow] duration-150 hover:border-edge hover:shadow-md dark:border-edge-subtle',
                      interaction.transition,
                    )}
                  >
                    <div className="flex gap-3">
                      <SkillCardIcon name={row.name} />
                      <div className="min-w-0 flex-1">
                        <h3 className="font-semibold leading-snug text-fg">{row.name}</h3>
                        <p className="mt-1 line-clamp-3 text-sm leading-relaxed text-fg-muted">
                          {row.description || '—'}
                        </p>
                      </div>
                      {row.managed ? (
                        <DropdownMenu.Root>
                          <DropdownMenu.Trigger asChild>
                            <button
                              type="button"
                              className={cn(
                                'absolute right-2 top-2 flex size-8 items-center justify-center rounded-lg text-fg-muted opacity-0 hover:bg-surface-hover hover:text-fg group-hover:opacity-100',
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
                    </div>
                    <div className="flex flex-wrap gap-2 text-[11px] text-fg-subtle">
                      <span className="rounded-md bg-surface-base px-2 py-0.5 dark:bg-surface-hover/60">
                        {sourceLabel(row.source)}
                      </span>
                      {row.managed ? (
                        <span className="rounded-md bg-surface-base px-2 py-0.5 dark:bg-surface-hover/60">
                          {sk.col.managed}: {sk.yes}
                        </span>
                      ) : null}
                    </div>
                  </article>
                ))
              )}
            </div>
          )}
        </section>
      </div>

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
              'xopcbot-dialog-content fixed left-1/2 top-1/2 z-[60] w-[min(100%-2rem,26rem)] -translate-x-1/2 -translate-y-1/2',
              'rounded-2xl border border-edge bg-surface-panel p-5 shadow-float dark:border-edge',
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
                'mt-4 flex cursor-pointer flex-col items-center justify-center gap-3 rounded-xl border-2 border-dashed px-4 py-10 text-center transition-colors',
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
