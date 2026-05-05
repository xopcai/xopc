import * as Dialog from '@radix-ui/react-dialog';
import * as DropdownMenu from '@radix-ui/react-dropdown-menu';
import {
  ChevronDown,
  ChevronLeft,
  ChevronRight,
  FileArchive,
  Funnel,
  Info,
  MoreVertical,
  Plus,
  RefreshCw,
  Search,
  Star,
  Trash2,
  X,
} from 'lucide-react';
import { useCallback, useEffect, useLayoutEffect, useMemo, useState } from 'react';
import { useLocation, useSearchParams } from 'react-router-dom';

import { MarkdownView } from '@/components/markdown/markdown-view';
import { Button } from '@/components/ui/button';
import { cn } from '@/lib/cn';
import { interaction } from '@/lib/interaction';
import {
  deleteSkill,
  getMarketplaceCategories,
  getMarketplacePackageDetail,
  getMarketplaceSkills,
  getSkillMarkdown,
  getSkills,
  installMarketplaceSkill,
  patchSkillEnabled,
  reloadSkills,
  uploadSkillZip,
} from '@/features/skills/skill-api';
import type {
  MarketplaceCategoryItem,
  MarketplacePackageItem,
  SkillCatalogEntry,
} from '@/features/skills/skill.types';
import { messages } from '@/i18n/messages';
import { useGatewayStore } from '@/stores/gateway-store';
import { useLocaleStore } from '@/stores/locale-store';
import { usePageHeaderStore } from '@/stores/page-header-store';

function interpolate(template: string, params: Record<string, string | number>): string {
  return template.replace(/\{\{(\w+)\}\}/g, (_, key) => String(params[key] ?? ''));
}

/** Pastel tile + saturated letter (light / dark pairs), stable per skill name hash. */
const SKILL_INITIAL_PALETTE: { light: string; dark: string }[] = [
  { light: 'bg-sky-100 text-sky-800', dark: 'dark:bg-sky-950/55 dark:text-sky-200' },
  { light: 'bg-violet-100 text-violet-800', dark: 'dark:bg-violet-950/55 dark:text-violet-200' },
  { light: 'bg-emerald-100 text-emerald-800', dark: 'dark:bg-emerald-950/55 dark:text-emerald-200' },
  { light: 'bg-orange-100 text-orange-800', dark: 'dark:bg-orange-950/55 dark:text-orange-200' },
  { light: 'bg-rose-100 text-rose-800', dark: 'dark:bg-rose-950/55 dark:text-rose-200' },
  { light: 'bg-amber-100 text-amber-900', dark: 'dark:bg-amber-950/55 dark:text-amber-200' },
  { light: 'bg-cyan-100 text-cyan-800', dark: 'dark:bg-cyan-950/55 dark:text-cyan-200' },
  { light: 'bg-indigo-100 text-indigo-800', dark: 'dark:bg-indigo-950/55 dark:text-indigo-200' },
  { light: 'bg-fuchsia-100 text-fuchsia-800', dark: 'dark:bg-fuchsia-950/55 dark:text-fuchsia-200' },
  { light: 'bg-teal-100 text-teal-800', dark: 'dark:bg-teal-950/55 dark:text-teal-200' },
];

function hashSkillNameKey(name: string): number {
  let h = 0;
  for (let i = 0; i < name.length; i += 1) {
    h = (Math.imul(31, h) + name.charCodeAt(i)) | 0;
  }
  return Math.abs(h);
}

/** First letter or digit (Unicode letters included); skips leading punctuation in slugs. */
function skillInitialLetter(name: string): string {
  const t = name.trim();
  if (!t) return '?';
  const m = t.match(/[\p{L}\p{N}]/u);
  if (m) {
    const ch = m[0];
    return ch.toLocaleUpperCase('en-US');
  }
  return t[0];
}

function SkillCardIcon({ name, className }: { name: string; className?: string }) {
  const initial = skillInitialLetter(name);
  const pair = SKILL_INITIAL_PALETTE[hashSkillNameKey(name) % SKILL_INITIAL_PALETTE.length];
  return (
    <div
      className={cn(
        'flex size-11 shrink-0 items-center justify-center rounded-xl font-semibold tracking-tight shadow-surface',
        'text-[1.05rem] ring-1 ring-inset ring-black/[0.06] dark:ring-white/[0.1]',
        'transition-[transform,box-shadow] duration-200 ease-out group-hover:ring-black/[0.1] dark:group-hover:ring-white/[0.14]',
        'group-hover:-translate-y-px',
        pair.light,
        pair.dark,
        className,
      )}
      aria-hidden
    >
      {initial}
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
  onChange,
}: {
  checked: boolean;
  onChange: (next: boolean) => void;
}) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={checked}
      className={cn(
        'relative h-6 w-10 shrink-0 overflow-hidden rounded-full border border-edge p-0.5',
        'transition-[border-color,background-color] duration-200 ease-out',
        'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent focus-visible:ring-offset-2 focus-visible:ring-offset-surface-base',
        'active:scale-[0.97] motion-reduce:transition-none motion-reduce:active:scale-100',
        checked ? 'bg-accent' : 'bg-surface-hover',
      )}
      onClick={() => onChange(!checked)}
    >
      <span
        className={cn(
          'pointer-events-none absolute left-0.5 top-1/2 block size-4 -translate-y-1/2 rounded-full bg-surface-panel shadow-surface ring-1 ring-edge/40 dark:ring-edge/55',
          'transition-transform duration-200 ease-out motion-reduce:transition-none',
          checked ? 'translate-x-5' : 'translate-x-0',
        )}
        aria-hidden
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
      <div className={cn('h-6 w-10 shrink-0 rounded-full', skel)} />
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
  /** Optimistic `enabled` until `load` completes — avoids switch lag + disabled/opacity flicker. */
  const [enabledOverride, setEnabledOverride] = useState<Record<string, boolean>>({});

  const [detailOpen, setDetailOpen] = useState(false);
  const [detailSource, setDetailSource] = useState<'catalog' | 'store'>('catalog');
  const [detailTitle, setDetailTitle] = useState('');
  const [detailMarkdown, setDetailMarkdown] = useState('');
  const [detailLoading, setDetailLoading] = useState(false);
  const [detailError, setDetailError] = useState<string | null>(null);

  const [marketSort, setMarketSort] = useState<'downloads' | 'newest'>('downloads');
  const [marketPage, setMarketPage] = useState(1);
  const [mpLoading, setMpLoading] = useState(false);
  const [mpError, setMpError] = useState<string | null>(null);
  const [mpPayload, setMpPayload] = useState<{
    items: MarketplacePackageItem[];
    meta: { page: number; pageSize: number; total: number; totalPages: number };
    provider?: 'store' | 'skillhub';
  } | null>(null);
  const [installingMarketName, setInstallingMarketName] = useState<string | null>(null);
  const [marketCategoryId, setMarketCategoryId] = useState('');
  const [mpCategories, setMpCategories] = useState<MarketplaceCategoryItem[]>([]);
  const [mpCategoriesError, setMpCategoriesError] = useState<string | null>(null);

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
    const nextMcat = searchParams.get('mcat') ?? '';
    if (nextTab === 'marketplace') {
      setMarketCategoryId((prev) => (prev === nextMcat ? prev : nextMcat));
    } else {
      setMarketCategoryId('');
    }
  }, [searchParams]);

  useEffect(() => {
    if (mainTab !== 'marketplace') return;
    setMarketPage(1);
  }, [searchQuery, marketSort, mainTab, marketCategoryId]);

  useEffect(() => {
    if (!hasToken || mainTab !== 'marketplace') return;
    let cancelled = false;
    setMpLoading(true);
    setMpError(null);
    void getMarketplaceSkills({
      q: searchQuery.trim() || undefined,
      page: marketPage,
      pageSize: 20,
      sort: marketSort,
      category: marketCategoryId.trim() || undefined,
    })
      .then((payload) => {
        if (!cancelled) setMpPayload(payload);
      })
      .catch((e) => {
        if (!cancelled) {
          setMpError(e instanceof Error ? e.message : sk.marketplaceLoadFailed);
          setMpPayload(null);
        }
      })
      .finally(() => {
        if (!cancelled) setMpLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [
    hasToken,
    mainTab,
    marketCategoryId,
    marketPage,
    marketSort,
    searchQuery,
    sk.marketplaceLoadFailed,
  ]);

  useEffect(() => {
    if (!hasToken || mainTab !== 'marketplace') return;
    let cancelled = false;
    setMpCategoriesError(null);
    void getMarketplaceCategories()
      .then((r) => {
        if (!cancelled) setMpCategories(r.items);
      })
      .catch((e) => {
        if (!cancelled) {
          setMpCategories([]);
          setMpCategoriesError(e instanceof Error ? e.message : sk.marketplaceCategoriesFailed);
        }
      });
    return () => {
      cancelled = true;
    };
  }, [hasToken, mainTab, sk.marketplaceCategoriesFailed]);

  useEffect(() => {
    if (!marketCategoryId.trim() || mpCategories.length === 0) return;
    if (!mpCategories.some((c) => c.id === marketCategoryId)) {
      setMarketCategoryId('');
    }
  }, [mpCategories, marketCategoryId]);

  // Sync controlled state → URL. Use functional `setSearchParams` and omit `searchParams`
  // from deps so updating the query string does not re-run this effect (avoids request storms).
  useEffect(() => {
    setSearchParams(
      (prev) => {
        const params = new URLSearchParams(prev);
        const nextQ = searchQuery.trim();
        if (nextQ) params.set('q', nextQ);
        else params.delete('q');
        if (mainTab !== 'builtin') params.set('tab', mainTab);
        else params.delete('tab');
        if (sourceFilter !== 'all') params.set('source', sourceFilter);
        else params.delete('source');
        if (mainTab === 'marketplace' && marketCategoryId.trim()) {
          params.set('mcat', marketCategoryId.trim());
        } else {
          params.delete('mcat');
        }
        if (params.toString() === prev.toString()) {
          return prev;
        }
        return params;
      },
      { replace: true },
    );
  }, [mainTab, marketCategoryId, searchQuery, setSearchParams, sourceFilter]);

  const showFeedback = useCallback((kind: 'success' | 'error', message: string, durationMs = 5000) => {
    setActionFeedback({ kind, message });
    window.setTimeout(() => setActionFeedback(null), durationMs);
  }, []);

  const openSkillDetail = useCallback(
    async (row: SkillCatalogEntry) => {
      setDetailSource('catalog');
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

  const openMarketplaceDetail = useCallback(
    async (packageId: string, listTitle?: string) => {
      setDetailSource('store');
      setDetailOpen(true);
      setDetailTitle(listTitle?.trim() || packageId);
      setDetailMarkdown('');
      setDetailError(null);
      setDetailLoading(true);
      try {
        const pkg = await getMarketplacePackageDetail(packageId);
        setDetailTitle(pkg.name);
        const readme = pkg.readme?.trim();
        if (readme) {
          setDetailMarkdown(readme);
        } else if (pkg.description?.trim()) {
          setDetailMarkdown(`## ${pkg.name}\n\n${pkg.description.trim()}`);
        } else {
          setDetailMarkdown(`*${sk.marketplaceNoReadme}*`);
        }
      } catch (e) {
        setDetailError(e instanceof Error ? e.message : sk.detailLoadFailed);
      } finally {
        setDetailLoading(false);
      }
    },
    [sk.detailLoadFailed, sk.marketplaceNoReadme],
  );

  const onSkillToggle = useCallback(
    async (name: string, next: boolean): Promise<boolean> => {
      setTogglingSkillName(name);
      setEnabledOverride((prev) => ({ ...prev, [name]: next }));
      setActionFeedback(null);
      try {
        await patchSkillEnabled(name, next);
        await load({ silent: true });
        return true;
      } catch (e) {
        setEnabledOverride((prev) => {
          const { [name]: _, ...rest } = prev;
          return rest;
        });
        const msg = e instanceof Error ? e.message : sk.skillToggleFailed;
        showFeedback('error', msg);
        return false;
      } finally {
        setTogglingSkillName(null);
        setEnabledOverride((prev) => {
          const { [name]: _, ...rest } = prev;
          return rest;
        });
      }
    },
    [load, showFeedback, sk.skillToggleFailed],
  );

  const onReloadClick = useCallback(async () => {
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
  }, [load, sk.reloadFailed]);

  const builtinTabStats = useMemo(() => {
    const rows = catalog.filter((r) => r.source === 'builtin');
    return {
      total: rows.length,
      enabled: rows.filter((r) => enabledOverride[r.name] ?? r.enabled).length,
    };
  }, [catalog, enabledOverride]);

  const userTabStats = useMemo(() => {
    const rows = catalog.filter((r) => r.source !== 'builtin');
    return {
      total: rows.length,
      enabled: rows.filter((r) => enabledOverride[r.name] ?? r.enabled).length,
    };
  }, [catalog, enabledOverride]);

  const detailFromCatalog = useMemo(
    () => (detailTitle ? catalog.find((r) => r.name === detailTitle) : undefined),
    [catalog, detailTitle],
  );
  const detailEnabled =
    detailFromCatalog == null
      ? true
      : (enabledOverride[detailTitle] ?? detailFromCatalog.enabled);

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
      const blob = [
        row.name,
        row.description,
        row.directoryId,
        row.path,
        row.source,
        row.hub?.source,
        row.hub?.ref,
      ]
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

  const isSkillInstalledByName = useCallback(
    (name: string) => catalog.some((r) => r.name === name),
    [catalog],
  );

  const onMarketInstall = useCallback(
    async (name: string) => {
      const installed = isSkillInstalledByName(name);
      if (installed) {
        const ok = window.confirm(sk.marketplaceReinstallConfirm);
        if (!ok) return;
      }
      setActionFeedback(null);
      setInstallingMarketName(name);
      try {
        await installMarketplaceSkill({ name, overwrite: installed });
        await load({ silent: true });
        showFeedback('success', sk.installSuccess);
        setDetailOpen(false);
        setMainTab('user');
      } catch (e) {
        showFeedback('error', e instanceof Error ? e.message : sk.uploadFailed);
      } finally {
        setInstallingMarketName(null);
      }
    },
    [
      isSkillInstalledByName,
      load,
      showFeedback,
      sk.installSuccess,
      sk.marketplaceReinstallConfirm,
      sk.uploadFailed,
    ],
  );

  const filterLabel =
    sourceFilter === 'all'
      ? sk.filterAll
      : sourceFilter === 'global'
        ? sk.filterGlobal
        : sourceFilter === 'workspace'
          ? sk.filterWorkspace
          : sk.filterExtra;

  const setPageHeader = usePageHeaderStore((s) => s.setPageHeader);
  const clearPageHeader = usePageHeaderStore((s) => s.clearPageHeader);
  const { pathname } = useLocation();
  const inSettingsShell = pathname.startsWith('/settings/');

  const skillsHeaderEnd = useMemo(
    () => (
      <div className="flex min-w-0 flex-1 flex-wrap items-center justify-end gap-2">
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
        <label className="relative flex min-h-9 min-w-0 max-w-sm cursor-text items-center rounded-pill border border-edge bg-surface-base py-1.5 pl-9 pr-3 shadow-surface dark:bg-surface-hover/40 sm:max-w-md">
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
            placeholder={mainTab === 'marketplace' ? sk.marketplaceSearchPackages : sk.searchPlaceholder}
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
    ),
    [
      loading,
      onReloadClick,
      searchQuery,
      setInstallOpen,
      setPendingFile,
      setSearchQuery,
      mainTab,
      sk.installCta,
      sk.marketplaceSearchPackages,
      sk.reloadDiskAria,
      sk.reloadRuntime,
      sk.searchPlaceholder,
    ],
  );

  useLayoutEffect(() => {
    if (!hasToken || inSettingsShell) {
      clearPageHeader();
      return () => clearPageHeader();
    }
    setPageHeader({
      startExtra: null,
      main: null,
      end: skillsHeaderEnd,
    });
    return () => clearPageHeader();
  }, [clearPageHeader, hasToken, inSettingsShell, setPageHeader, skillsHeaderEnd]);

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
          <div className="min-w-0">
            <h1 className="text-xl font-semibold tracking-tight text-fg">{sk.title}</h1>
            <p className="mt-1 max-w-2xl text-sm text-fg-muted">{sk.tagline}</p>
          </div>
        </header>

        {inSettingsShell ? (
          <div className="flex flex-col gap-3 border-b border-edge-subtle pb-4 dark:border-edge-subtle sm:flex-row sm:flex-wrap sm:items-center sm:justify-end">
            {skillsHeaderEnd}
          </div>
        ) : null}

        <section className="flex flex-col gap-4">
          <div className="flex flex-col gap-3 border-b border-edge-subtle pb-3 sm:flex-row sm:items-center sm:justify-between dark:border-edge-subtle">
            <div className="flex gap-1" role="tablist" aria-label={sk.skillsNavAria}>
              <button
                type="button"
                role="tab"
                aria-selected={mainTab === 'builtin'}
                className={cn(
                  'relative rounded-md px-3 py-2 text-sm font-medium transition-colors',
                  mainTab === 'builtin' ? 'text-fg' : 'text-fg-muted hover:text-fg',
                  mainTab === 'builtin' &&
                    'after:absolute after:bottom-0 after:left-1/2 after:h-0.5 after:w-9 after:-translate-x-1/2 after:rounded-full after:bg-accent',
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
                  'relative rounded-md px-3 py-2 text-sm font-medium transition-colors',
                  mainTab === 'user' ? 'text-fg' : 'text-fg-muted hover:text-fg',
                  mainTab === 'user' &&
                    'after:absolute after:bottom-0 after:left-1/2 after:h-0.5 after:w-9 after:-translate-x-1/2 after:rounded-full after:bg-accent',
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
                  'relative rounded-md px-3 py-2 text-sm font-medium transition-colors',
                  mainTab === 'marketplace' ? 'text-fg' : 'text-fg-muted hover:text-fg',
                  mainTab === 'marketplace' &&
                    'after:absolute after:bottom-0 after:left-1/2 after:h-0.5 after:w-9 after:-translate-x-1/2 after:rounded-full after:bg-accent',
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
                        'inline-flex h-9 min-h-9 min-w-[9rem] shrink-0 items-center gap-1.5 rounded-lg border border-edge bg-surface-panel px-2.5 text-xs font-medium text-fg shadow-surface',
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
              {mainTab === 'marketplace' ? (
                <DropdownMenu.Root>
                  <DropdownMenu.Trigger asChild>
                    <button
                      type="button"
                      className={cn(
                        'inline-flex h-9 min-h-9 min-w-[9rem] shrink-0 items-center gap-1.5 rounded-lg border border-edge bg-surface-panel px-2.5 text-xs font-medium text-fg shadow-surface',
                        interaction.transition,
                        interaction.focusRingPanel,
                      )}
                    >
                      <Funnel className="size-3.5 text-fg-muted" strokeWidth={1.75} aria-hidden />
                      <span>
                        {marketSort === 'newest' ? sk.marketplaceSortNewest : sk.marketplaceSortDownloads}
                      </span>
                      <ChevronDown className="size-3.5 text-fg-subtle" strokeWidth={1.75} aria-hidden />
                    </button>
                  </DropdownMenu.Trigger>
                  <DropdownMenu.Portal>
                    <DropdownMenu.Content
                      className="z-50 min-w-[10rem] rounded-xl border border-edge bg-surface-panel p-1 shadow-popover dark:border-edge"
                      sideOffset={6}
                      align="end"
                    >
                      <DropdownMenu.Item
                        className={cn(
                          'cursor-pointer rounded-lg px-3 py-2 text-sm text-fg outline-none',
                          'hover:bg-surface-hover data-[highlighted]:bg-surface-hover',
                        )}
                        onSelect={() => setMarketSort('downloads')}
                      >
                        {sk.marketplaceSortDownloads}
                      </DropdownMenu.Item>
                      <DropdownMenu.Item
                        className={cn(
                          'cursor-pointer rounded-lg px-3 py-2 text-sm text-fg outline-none',
                          'hover:bg-surface-hover data-[highlighted]:bg-surface-hover',
                        )}
                        onSelect={() => setMarketSort('newest')}
                      >
                        {sk.marketplaceSortNewest}
                      </DropdownMenu.Item>
                    </DropdownMenu.Content>
                  </DropdownMenu.Portal>
                </DropdownMenu.Root>
              ) : null}
            </div>
          </div>

          {mainTab === 'marketplace' ? (
            <>
              <div className="flex items-center justify-between">
                <p className="text-xs font-medium uppercase tracking-wide text-fg-subtle">
                  {sk.sectionMarketplace}
                </p>
                <span className="rounded-md bg-surface-hover/60 px-2 py-0.5 text-[11px] text-fg-subtle dark:bg-surface-active/50">
                  {mpPayload?.provider === 'skillhub'
                    ? 'SkillHub (skillhub.cn)'
                    : 'xopc Store (store.xopc.ai)'}
                </span>
              </div>
              {mpCategories.length > 0 ? (
                <div
                  role="tablist"
                  aria-label={sk.marketplaceCategoriesAria}
                  className="-mx-1 flex gap-2 overflow-x-auto px-1 pb-1 pt-0.5 [scrollbar-width:thin]"
                >
                  <button
                    type="button"
                    role="tab"
                    aria-selected={marketCategoryId === ''}
                    className={cn(
                      'shrink-0 rounded-full border px-3 py-1.5 text-xs font-medium transition-colors',
                      interaction.focusRingPanel,
                      marketCategoryId === ''
                        ? 'border-fg bg-fg text-surface-panel dark:border-fg dark:bg-fg dark:text-surface-base'
                        : 'border-edge bg-surface-panel text-fg-muted hover:border-edge-strong hover:text-fg dark:border-edge dark:bg-surface-hover/40',
                    )}
                    onClick={() => setMarketCategoryId('')}
                  >
                    {sk.marketplaceCategoryAll}
                  </button>
                  {mpCategories.map((c) => {
                    const selected = marketCategoryId === c.id;
                    return (
                      <button
                        key={c.id}
                        type="button"
                        role="tab"
                        aria-selected={selected}
                        className={cn(
                          'max-w-[14rem] shrink-0 truncate rounded-full border px-3 py-1.5 text-xs font-medium transition-colors',
                          interaction.focusRingPanel,
                          selected
                            ? 'border-fg bg-fg text-surface-panel dark:border-fg dark:bg-fg dark:text-surface-base'
                            : 'border-edge bg-surface-panel text-fg-muted hover:border-edge-strong hover:text-fg dark:border-edge dark:bg-surface-hover/40',
                        )}
                        title={c.label}
                        onClick={() => setMarketCategoryId(c.id)}
                      >
                        {c.label}
                      </button>
                    );
                  })}
                </div>
              ) : null}
              {mpCategoriesError ? (
                <p className="text-xs text-red-600 dark:text-red-400" role="alert">
                  {mpCategoriesError}
                </p>
              ) : null}
              {mpLoading ? (
                <div
                  className="overflow-hidden rounded-2xl border border-edge-subtle bg-surface-base dark:border-edge-subtle"
                  aria-busy="true"
                  aria-label={sk.loading}
                >
                  {Array.from({ length: SKILL_LIST_SKELETON_COUNT }, (_, i) => (
                    <SkillListRowSkeleton key={i} />
                  ))}
                </div>
              ) : mpError ? (
                <div
                  className="rounded-xl border border-edge bg-red-50 px-3 py-2 text-sm text-red-700 dark:border-edge dark:bg-red-950/40 dark:text-red-300"
                  role="alert"
                >
                  {mpError}
                </div>
              ) : !mpPayload || mpPayload.items.length === 0 ? (
                <div className="rounded-2xl border border-dashed border-edge py-16 text-center text-sm text-fg-muted">
                  {sk.marketplaceEmpty}
                </div>
              ) : (
                <>
                  <div className="overflow-hidden rounded-2xl border border-edge-subtle bg-surface-base dark:border-edge-subtle">
                    {mpPayload.items.map((row) => {
                      const installed = isSkillInstalledByName(row.id);
                      const busy = installingMarketName === row.id;
                      return (
                        <article
                          key={row.id}
                          className={cn(
                            'group relative flex flex-col gap-3 border-b border-edge-subtle px-4 py-3.5 last:border-b-0 sm:flex-row sm:items-center',
                            'transition-colors hover:bg-surface-hover/50 dark:hover:bg-surface-hover/25',
                          )}
                        >
                          <button
                            type="button"
                            className={cn(
                              'flex min-w-0 flex-1 cursor-pointer items-start gap-4 rounded-xl text-left outline-none',
                              interaction.focusRingPanel,
                            )}
                            onClick={() => void openMarketplaceDetail(row.id, row.name)}
                          >
                            <SkillCardIcon name={row.id} />
                            <div className="min-w-0 flex-1 pr-2">
                              <h3 className="text-[15px] font-semibold leading-snug tracking-tight text-fg">
                                {row.name}
                              </h3>
                              <p
                                className="mt-0.5 line-clamp-2 text-sm leading-relaxed text-fg-muted"
                                title={row.description || undefined}
                              >
                                {row.description || '—'}
                              </p>
                              <div className="mt-1.5 flex flex-wrap gap-1.5 text-[11px] text-fg-subtle">
                                <span className="rounded-md bg-surface-hover/60 px-2 py-0.5 dark:bg-surface-active/50">
                                  {sk.marketplaceAuthor}: {row.author.username}
                                </span>
                                <span className="rounded-md bg-surface-hover/60 px-2 py-0.5 dark:bg-surface-active/50">
                                  {sk.marketplaceDownloads}: {row.downloads}
                                </span>
                                {row.stars != null && row.stars > 0 ? (
                                  <span className="inline-flex items-center gap-0.5 rounded-md bg-surface-hover/60 px-2 py-0.5 dark:bg-surface-active/50">
                                    <Star className="size-3 shrink-0 text-amber-600 dark:text-amber-400" strokeWidth={2} aria-hidden />
                                    {row.stars}
                                  </span>
                                ) : null}
                                {row.sourceLabel ? (
                                  <span className="rounded-md bg-surface-hover/60 px-2 py-0.5 dark:bg-surface-active/50">
                                    {sk.marketplaceSource}: {row.sourceLabel}
                                  </span>
                                ) : null}
                                {row.latestVersion ? (
                                  <span className="rounded-md bg-surface-hover/60 px-2 py-0.5 font-mono text-[10px] dark:bg-surface-active/50">
                                    {sk.marketplaceVersion}: {row.latestVersion}
                                  </span>
                                ) : null}
                                {installed ? (
                                  <span className="rounded-md bg-emerald-500/15 px-2 py-0.5 text-emerald-800 dark:text-emerald-200">
                                    {sk.marketplaceInstalled}
                                  </span>
                                ) : null}
                              </div>
                            </div>
                          </button>
                          <div className="flex shrink-0 justify-end sm:pl-2">
                            <Button
                              type="button"
                              variant={installed ? 'secondary' : 'primary'}
                              className="min-w-[6.5rem]"
                              disabled={busy || mpLoading}
                              onClick={() => void onMarketInstall(row.id)}
                            >
                              {busy ? sk.uploading : installed ? sk.marketplaceReinstall : sk.marketplaceInstall}
                            </Button>
                          </div>
                        </article>
                      );
                    })}
                  </div>
                  <div className="flex flex-col items-center justify-between gap-3 sm:flex-row">
                    <p className="text-center text-xs text-fg-muted sm:text-left">
                      {interpolate(sk.marketplacePageStatus, {
                        page: mpPayload.meta.page,
                        totalPages: mpPayload.meta.totalPages,
                        total: mpPayload.meta.total,
                      })}
                    </p>
                    <div className="flex items-center gap-2">
                      <Button
                        type="button"
                        variant="ghost"
                        className="h-9 gap-1 px-2"
                        disabled={mpLoading || marketPage <= 1}
                        aria-label={sk.marketplacePagePrev}
                        onClick={() => setMarketPage((p) => Math.max(1, p - 1))}
                      >
                        <ChevronLeft className="size-4" strokeWidth={1.75} aria-hidden />
                        <span className="sr-only sm:not-sr-only">{sk.marketplacePagePrev}</span>
                      </Button>
                      <Button
                        type="button"
                        variant="ghost"
                        className="h-9 gap-1 px-2"
                        disabled={mpLoading || marketPage >= mpPayload.meta.totalPages}
                        aria-label={sk.marketplacePageNext}
                        onClick={() =>
                          setMarketPage((p) => Math.min(mpPayload.meta.totalPages, p + 1))
                        }
                      >
                        <span className="sr-only sm:not-sr-only">{sk.marketplacePageNext}</span>
                        <ChevronRight className="size-4" strokeWidth={1.75} aria-hidden />
                      </Button>
                    </div>
                  </div>
                </>
              )}
            </>
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
                      className={cn(
                        'group relative flex items-center gap-4 border-b border-edge-subtle px-4 py-3.5 last:border-b-0',
                        'transition-colors hover:bg-surface-hover/50 dark:hover:bg-surface-hover/25',
                      )}
                    >
                      <button
                        type="button"
                        className={cn(
                          'flex min-w-0 flex-1 cursor-pointer items-center gap-4 rounded-lg text-left outline-none',
                          interaction.focusRingPanel,
                        )}
                        onClick={() => void openSkillDetail(row)}
                      >
                        <SkillCardIcon name={row.name} />
                        <div className="min-w-0 flex-1 pr-2">
                          <h3 className="text-[15px] font-semibold leading-snug tracking-tight text-fg">
                            {row.name}
                          </h3>
                          <p
                            className="mt-0.5 truncate text-sm leading-relaxed text-fg-muted"
                            title={row.description ? row.description : undefined}
                          >
                            {row.description || '—'}
                          </p>
                          {mainTab !== 'builtin' || row.managed ? (
                            <div className="mt-1.5 flex flex-wrap gap-1.5 text-[11px] text-fg-subtle">
                              {mainTab !== 'builtin' ? (
                                <span className="rounded-md bg-surface-hover/60 px-2 py-0.5 dark:bg-surface-active/50">
                                  {sourceLabel(row.source)}
                                </span>
                              ) : null}
                              {row.managed ? (
                                <span className="rounded-md bg-surface-hover/60 px-2 py-0.5 dark:bg-surface-active/50">
                                  {sk.col.managed}: {sk.yes}
                                </span>
                              ) : null}
                              {row.hub ? (
                                <span
                                  className="max-w-full truncate rounded-md bg-surface-hover/60 px-2 py-0.5 font-mono text-[10px] dark:bg-surface-active/50"
                                  title={`${row.hub.source}${row.hub.ref ? `\nref: ${row.hub.ref}` : ''}\nupdated: ${row.hub.updatedAt}`}
                                >
                                  {sk.hubRemote} ·{' '}
                                  {row.hub.kind === 'git' ? sk.hubKindGit : sk.hubKindArchive} ·{' '}
                                  {row.hub.source.length > 48
                                    ? `${row.hub.source.slice(0, 48)}…`
                                    : row.hub.source}
                                </span>
                              ) : null}
                            </div>
                          ) : null}
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
                          checked={enabledOverride[row.name] ?? row.enabled}
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
            setDetailSource('catalog');
            setDetailMarkdown('');
            setDetailError(null);
            setDetailTitle('');
          }
        }}
      >
        <Dialog.Portal>
          <Dialog.Overlay className="xopc-dialog-overlay fixed inset-0 z-[60] bg-scrim" />
          <Dialog.Content
            className={cn(
              'xopc-dialog-content fixed left-1/2 top-1/2 z-[60] flex h-[min(88vh,44rem)] max-h-[min(92vh,56rem)] w-[min(100%-2rem,min(92vw,56rem))]',
              '-translate-x-1/2 -translate-y-1/2 flex-col overflow-hidden rounded-2xl border border-edge bg-surface-panel shadow-float dark:border-edge',
            )}
          >
            <div className="group flex min-h-[3.25rem] shrink-0 items-center gap-3 border-b border-edge px-4 py-3">
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
            <div className="flex min-h-[3.25rem] shrink-0 items-start gap-2 border-b border-blue-200/80 bg-blue-50/95 px-4 py-2.5 text-sm text-fg dark:border-blue-900/50 dark:bg-blue-950/45">
              <Info className="mt-0.5 size-4 shrink-0 text-blue-600 dark:text-blue-400" strokeWidth={1.75} aria-hidden />
              <p className="min-w-0 leading-relaxed">
                {detailSource === 'store' ? sk.detailModalBannerStore : sk.detailModalBanner}
              </p>
            </div>
            <div className="min-h-0 min-w-0 flex-1 overflow-auto px-4 py-4">
              {detailLoading ? (
                <div
                  className="flex h-full min-h-[14rem] flex-col gap-2.5 py-1"
                  aria-busy="true"
                  aria-label={sk.loading}
                >
                  {Array.from({ length: 10 }, (_, i) => (
                    <div
                      key={i}
                      className={cn(
                        'h-4 animate-pulse rounded-md bg-surface-hover dark:bg-surface-active/50',
                        i % 3 === 0 ? 'w-[92%]' : i % 3 === 1 ? 'w-full' : 'w-4/5',
                      )}
                    />
                  ))}
                </div>
              ) : detailError ? (
                <p className="text-sm text-red-600 dark:text-red-400">{detailError}</p>
              ) : (
                <div className="markdown-content min-w-0 break-words">
                  <MarkdownView content={detailMarkdown} />
                </div>
              )}
            </div>
            <div className="flex shrink-0 justify-end gap-2 border-t border-edge px-4 py-3">
              {detailSource === 'store' ? (
                <>
                  <Button type="button" variant="ghost" onClick={() => setDetailOpen(false)}>
                    {sk.cancel}
                  </Button>
                  <Button
                    type="button"
                    variant={isSkillInstalledByName(detailTitle) ? 'secondary' : 'primary'}
                    disabled={!detailTitle || installingMarketName === detailTitle}
                    onClick={() => {
                      if (!detailTitle) return;
                      void onMarketInstall(detailTitle);
                    }}
                  >
                    {installingMarketName === detailTitle
                      ? sk.uploading
                      : isSkillInstalledByName(detailTitle)
                        ? sk.marketplaceReinstall
                        : sk.marketplaceInstall}
                  </Button>
                </>
              ) : (
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
              )}
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
          <Dialog.Overlay className="xopc-dialog-overlay fixed inset-0 z-[60] bg-scrim" />
          <Dialog.Content
            className={cn(
              'xopc-dialog-content fixed left-1/2 top-1/2 z-[60] max-h-[min(100vh-2rem,44rem)] w-[min(100%-2rem,min(92vw,48rem))] -translate-x-1/2 -translate-y-1/2 overflow-y-auto',
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
                  : 'bg-accent text-white hover:bg-accent-hover',
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
          <Dialog.Overlay className="xopc-dialog-overlay fixed inset-0 z-[60] bg-scrim" />
          <Dialog.Content className="xopc-dialog-content fixed left-1/2 top-1/2 z-[60] w-[min(100%-2rem,24rem)] -translate-x-1/2 -translate-y-1/2 rounded-xl border border-edge bg-surface-panel p-4 shadow-popover dark:border-edge">
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
