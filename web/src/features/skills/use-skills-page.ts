import {
  useCallback,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
  type ChangeEvent,
  type DragEvent,
} from 'react';
import { useLocation, useNavigate, useSearchParams } from 'react-router-dom';

import {
  deleteSkill,
  getMarketplaceCategories,
  getMarketplacePackageDetail,
  getMarketplaceProvider,
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
  SkillMarkdownPreviewPayload,
} from '@/features/skills/skill.types';
import { fileToZipUpload } from '@/features/skills/skill-upload-zip';
import {
  BUILTIN_SKILL_CATEGORY_ORDER,
  MAIN_TAB_SET,
  MARKETPLACE_PROVIDER_PARAM,
  SOURCE_FILTER_SET,
  type MainTab,
  type SourceFilter,
} from '@/features/skills/skills-page.constants';
import { normalizeCatalogEntry } from '@/features/skills/skills-page.utils';
import { messages } from '@/i18n/messages';
import { useGatewayStore } from '@/stores/gateway-store';
import { useLocaleStore } from '@/stores/locale-store';

export function useSkillsPage() {
  const language = useLocaleStore((s) => s.language);
  const m = messages(language);
  const sk = m.skills;
  const token = useGatewayStore((st) => st.token);
  const hasToken = Boolean(token);
  const navigate = useNavigate();
  const [searchParams, setSearchParams] = useSearchParams();

  const mprovRaw = searchParams.get(MARKETPLACE_PROVIDER_PARAM);
  const urlMarketProvider =
    mprovRaw === 'store' || mprovRaw === 'skillhub' ? mprovRaw : null;

  const [catalog, setCatalog] = useState<SkillCatalogEntry[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [uploading, setUploading] = useState(false);
  const initialSearch = searchParams.get('q') ?? '';
  const initialTabRaw = searchParams.get('tab');
  const initialSourceRaw = searchParams.get('source');
  const initialTab: MainTab = MAIN_TAB_SET.has(initialTabRaw as MainTab)
    ? (initialTabRaw as MainTab)
    : 'marketplace';
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
  const [builtinCategoryFilter, setBuiltinCategoryFilter] = useState('');

  const [installOpen, setInstallOpen] = useState(false);
  const [pendingFile, setPendingFile] = useState<File | null>(null);
  const [dropActive, setDropActive] = useState(false);

  const [confirmOpen, setConfirmOpen] = useState(false);
  const [confirmId, setConfirmId] = useState<string | null>(null);
  const [togglingSkillName, setTogglingSkillName] = useState<string | null>(null);
  const [enabledOverride, setEnabledOverride] = useState<Record<string, boolean>>({});

  const [detailOpen, setDetailOpen] = useState(false);
  const [detailSource, setDetailSource] = useState<'catalog' | 'store'>('catalog');
  const [detailTitle, setDetailTitle] = useState('');
  const [detailMarkdown, setDetailMarkdown] = useState('');
  const [detailCatalogPreview, setDetailCatalogPreview] = useState<SkillMarkdownPreviewPayload | null>(null);
  const [detailMarketplacePreview, setDetailMarketplacePreview] = useState<SkillMarkdownPreviewPayload | null>(
    null,
  );
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
  const [usingSkillInChatName, setUsingSkillInChatName] = useState<string | null>(null);
  const [marketCategoryId, setMarketCategoryId] = useState('');
  const [mpCategories, setMpCategories] = useState<MarketplaceCategoryItem[]>([]);
  const [mpCategoriesError, setMpCategoriesError] = useState<string | null>(null);
  const [mpCategoriesLoading, setMpCategoriesLoading] = useState(false);
  const [marketBrowseProvider, setMarketBrowseProvider] = useState<'store' | 'skillhub' | null>(null);
  const marketplaceDetailProviderRef = useRef<'store' | 'skillhub' | null>(null);
  const prevMarketBrowseProviderRef = useRef<'store' | 'skillhub' | null>(null);

  const load = useCallback(
    async (opts?: { silent?: boolean }): Promise<{ ok: true } | { ok: false; message: string }> => {
      const silent = opts?.silent === true;
      if (!silent) {
        setLoading(true);
      }
      setError(null);
      try {
        const data = await getSkills(language !== 'en' ? language : undefined);
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
    [language, sk.loadFailed],
  );

  useEffect(() => {
    if (!hasToken) return;
    void load();
  }, [hasToken, load]);

  useEffect(() => {
    if (!hasToken) {
      setMarketBrowseProvider(null);
      marketplaceDetailProviderRef.current = null;
      return;
    }
    if (urlMarketProvider) {
      setMarketBrowseProvider(urlMarketProvider);
    }
  }, [hasToken, urlMarketProvider]);

  useEffect(() => {
    if (!hasToken || urlMarketProvider != null) return;
    let cancelled = false;
    void getMarketplaceProvider()
      .then((info) => {
        if (!cancelled) {
          setMarketBrowseProvider((prev) => (prev != null ? prev : info.provider));
        }
      })
      .catch(() => {
        if (!cancelled) {
          setMarketBrowseProvider((prev) => (prev != null ? prev : 'skillhub'));
        }
      });
    return () => {
      cancelled = true;
    };
  }, [hasToken, urlMarketProvider]);

  useEffect(() => {
    const nextQ = searchParams.get('q') ?? '';
    const nextTabRaw = searchParams.get('tab');
    const nextSourceRaw = searchParams.get('source');
    const nextTab: MainTab = MAIN_TAB_SET.has(nextTabRaw as MainTab)
      ? (nextTabRaw as MainTab)
      : 'marketplace';
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
  }, [searchQuery, marketSort, mainTab, marketCategoryId, marketBrowseProvider]);

  useEffect(() => {
    if (mainTab !== 'marketplace' || !marketBrowseProvider) {
      prevMarketBrowseProviderRef.current = marketBrowseProvider;
      return;
    }
    const prev = prevMarketBrowseProviderRef.current;
    prevMarketBrowseProviderRef.current = marketBrowseProvider;
    if (prev != null && prev !== marketBrowseProvider) {
      setMarketCategoryId('');
    }
  }, [mainTab, marketBrowseProvider]);

  /** Before paint: avoid one frame of empty/stale list then skeleton (useEffect runs too late). */
  useLayoutEffect(() => {
    if (!hasToken || mainTab !== 'marketplace') return;
    setMpLoading(true);
  }, [hasToken, mainTab, marketCategoryId, marketPage, marketSort, searchQuery, marketBrowseProvider]);

  useLayoutEffect(() => {
    if (!hasToken || mainTab !== 'marketplace') return;
    setMpCategoriesLoading(true);
  }, [hasToken, mainTab, marketBrowseProvider]);

  useEffect(() => {
    if (mainTab === 'marketplace') return;
    setMpCategories([]);
    setMpCategoriesError(null);
    setMpCategoriesLoading(false);
  }, [mainTab]);

  useEffect(() => {
    if (!hasToken || mainTab !== 'marketplace' || !marketBrowseProvider) return;
    let cancelled = false;
    setMpError(null);
    void getMarketplaceSkills({
      q: searchQuery.trim() || undefined,
      page: marketPage,
      pageSize: 20,
      sort: marketSort,
      category: marketCategoryId.trim() || undefined,
      provider: marketBrowseProvider,
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
    marketBrowseProvider,
  ]);

  useEffect(() => {
    if (!hasToken || mainTab !== 'marketplace' || !marketBrowseProvider) return;
    let cancelled = false;
    setMpCategoriesError(null);
    void getMarketplaceCategories({ provider: marketBrowseProvider })
      .then((r) => {
        if (!cancelled) setMpCategories(r.items);
      })
      .catch((e) => {
        if (!cancelled) {
          setMpCategories([]);
          setMpCategoriesError(e instanceof Error ? e.message : sk.marketplaceCategoriesFailed);
        }
      })
      .finally(() => {
        if (!cancelled) setMpCategoriesLoading(false);
      });
    return () => {
      cancelled = true;
      setMpCategoriesLoading(false);
    };
  }, [hasToken, mainTab, sk.marketplaceCategoriesFailed, marketBrowseProvider]);

  useEffect(() => {
    if (!marketCategoryId.trim() || mpCategories.length === 0) return;
    if (!mpCategories.some((c) => c.id === marketCategoryId)) {
      setMarketCategoryId('');
    }
  }, [mpCategories, marketCategoryId]);

  useEffect(() => {
    setSearchParams(
      (prev) => {
        const params = new URLSearchParams(prev);
        const nextQ = searchQuery.trim();
        if (nextQ) params.set('q', nextQ);
        else params.delete('q');
        if (mainTab !== 'marketplace') params.set('tab', mainTab);
        else params.delete('tab');
        if (sourceFilter !== 'all') params.set('source', sourceFilter);
        else params.delete('source');
        if (mainTab === 'marketplace' && marketCategoryId.trim()) {
          params.set('mcat', marketCategoryId.trim());
        } else {
          params.delete('mcat');
        }
        if (mainTab === 'marketplace' && marketBrowseProvider) {
          params.set(MARKETPLACE_PROVIDER_PARAM, marketBrowseProvider);
        } else {
          params.delete(MARKETPLACE_PROVIDER_PARAM);
        }
        if (params.toString() === prev.toString()) {
          return prev;
        }
        return params;
      },
      { replace: true },
    );
  }, [mainTab, marketCategoryId, marketBrowseProvider, searchQuery, setSearchParams, sourceFilter]);

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
      setDetailCatalogPreview(null);
      setDetailMarketplacePreview(null);
      setDetailError(null);
      setDetailLoading(true);
      try {
        const preview = await getSkillMarkdown(row.name, language !== 'en' ? language : undefined);
        setDetailCatalogPreview(preview);
        setDetailTitle(preview.name);
      } catch (e) {
        setDetailCatalogPreview(null);
        setDetailError(e instanceof Error ? e.message : sk.detailLoadFailed);
      } finally {
        setDetailLoading(false);
      }
    },
    [language, sk.detailLoadFailed],
  );

  const openMarketplaceDetail = useCallback(
    async (packageId: string, listTitle?: string) => {
      const browse = marketBrowseProvider;
      if (!browse) return;
      marketplaceDetailProviderRef.current = browse;
      setDetailSource('store');
      setDetailOpen(true);
      setDetailTitle(listTitle?.trim() || packageId);
      setDetailMarkdown('');
      setDetailCatalogPreview(null);
      setDetailMarketplacePreview(null);
      setDetailError(null);
      setDetailLoading(true);
      try {
        const pkg = await getMarketplacePackageDetail(packageId, { provider: browse });
        setDetailTitle(pkg.name);
        if (pkg.skillDocPreview) {
          setDetailMarketplacePreview(pkg.skillDocPreview);
          setDetailMarkdown('');
        } else {
          setDetailMarketplacePreview(null);
          const readme = pkg.readme?.trim();
          if (readme) {
            setDetailMarkdown(readme);
          } else if (pkg.description?.trim()) {
            setDetailMarkdown(`## ${pkg.name}\n\n${pkg.description.trim()}`);
          } else {
            setDetailMarkdown(`*${sk.marketplaceNoReadme}*`);
          }
        }
      } catch (e) {
        setDetailMarketplacePreview(null);
        setDetailError(e instanceof Error ? e.message : sk.detailLoadFailed);
      } finally {
        setDetailLoading(false);
      }
    },
    [marketBrowseProvider, sk.detailLoadFailed, sk.marketplaceNoReadme],
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

  const builtinCategories = useMemo(() => {
    const seen = new Set<string>();
    const ordered: string[] = [];
    for (const entry of filteredCatalog) {
      const cat = entry.category;
      if (!cat || seen.has(cat)) continue;
      seen.add(cat);
      ordered.push(cat);
    }
    return ordered.sort((a, b) => {
      const ai = BUILTIN_SKILL_CATEGORY_ORDER.indexOf(a as (typeof BUILTIN_SKILL_CATEGORY_ORDER)[number]);
      const bi = BUILTIN_SKILL_CATEGORY_ORDER.indexOf(b as (typeof BUILTIN_SKILL_CATEGORY_ORDER)[number]);
      if (ai >= 0 && bi >= 0) return ai - bi;
      if (ai >= 0) return -1;
      if (bi >= 0) return 1;
      return a.localeCompare(b);
    });
  }, [filteredCatalog]);

  const categoryLabel = useCallback(
    (cat: string): string => {
      const labels = sk.categoryLabel as Record<string, string> | undefined;
      return labels?.[cat] || cat;
    },
    [sk.categoryLabel],
  );

  const categoryFilteredCatalog = useMemo(() => {
    if (!builtinCategoryFilter) return filteredCatalog;
    return filteredCatalog.filter((r) => r.category === builtinCategoryFilter);
  }, [filteredCatalog, builtinCategoryFilter]);

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

  const onFileInputChange = (e: ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    e.target.value = '';
    if (file) setPendingFile(file);
  };

  const onModalDragOver = (e: DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
    if (e.dataTransfer.types.includes('Files')) {
      setDropActive(true);
      e.dataTransfer.dropEffect = 'copy';
    }
  };

  const onModalDragLeave = (e: DragEvent) => {
    const root = e.currentTarget as HTMLElement;
    const to = e.relatedTarget as Node | null;
    if (to && root.contains(to)) return;
    setDropActive(false);
  };

  const onModalDrop = (e: DragEvent) => {
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

  const onUseSkillInChat = useCallback(async () => {
    const name = detailTitle.trim();
    if (!name) return;
    setActionFeedback(null);
    const needsMarketInstall = detailSource === 'store' && !isSkillInstalledByName(name);
    if (needsMarketInstall) setUsingSkillInChatName(name);
    try {
      if (needsMarketInstall) {
        const mp = marketplaceDetailProviderRef.current ?? marketBrowseProvider;
        await installMarketplaceSkill({
          name,
          overwrite: false,
          ...(mp ? { provider: mp } : {}),
        });
        await load({ silent: true });
      }
      setDetailOpen(false);
      navigate(`/chat/new?skill=${encodeURIComponent(name)}`);
    } catch (e) {
      showFeedback('error', e instanceof Error ? e.message : sk.uploadFailed);
    } finally {
      setUsingSkillInChatName(null);
    }
  }, [
    detailTitle,
    detailSource,
    isSkillInstalledByName,
    load,
    navigate,
    showFeedback,
    sk.uploadFailed,
    marketBrowseProvider,
  ]);

  const onMarketInstall = useCallback(
    async (name: string, opts?: { useDetailProvider?: boolean }) => {
      const installed = isSkillInstalledByName(name);
      if (installed) {
        const ok = window.confirm(sk.marketplaceReinstallConfirm);
        if (!ok) return;
      }
      setActionFeedback(null);
      setInstallingMarketName(name);
      try {
        const p = opts?.useDetailProvider
          ? marketplaceDetailProviderRef.current ?? marketBrowseProvider
          : marketBrowseProvider;
        await installMarketplaceSkill({
          name,
          overwrite: installed,
          ...(p ? { provider: p } : {}),
        });
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
      marketBrowseProvider,
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

  const { pathname } = useLocation();
  const inSettingsShell = pathname.startsWith('/settings/');

  return {
    sk,
    hasToken,
    catalog,
    loading,
    error,
    uploading,
    searchQuery,
    setSearchQuery,
    actionFeedback,
    mainTab,
    setMainTab,
    sourceFilter,
    setSourceFilter,
    builtinCategoryFilter,
    setBuiltinCategoryFilter,
    installOpen,
    setInstallOpen,
    pendingFile,
    setPendingFile,
    dropActive,
    setDropActive,
    confirmOpen,
    setConfirmOpen,
    confirmId,
    setConfirmId,
    togglingSkillName,
    enabledOverride,
    detailOpen,
    setDetailOpen,
    detailSource,
    setDetailSource,
    detailTitle,
    setDetailTitle,
    detailMarkdown,
    setDetailMarkdown,
    detailCatalogPreview,
    setDetailCatalogPreview,
    detailMarketplacePreview,
    setDetailMarketplacePreview,
    detailLoading,
    detailError,
    setDetailError,
    marketSort,
    setMarketSort,
    marketPage,
    setMarketPage,
    mpLoading,
    mpError,
    mpPayload,
    installingMarketName,
    usingSkillInChatName,
    onUseSkillInChat,
    marketCategoryId,
    setMarketCategoryId,
    mpCategories,
    mpCategoriesError,
    mpCategoriesLoading,
    marketBrowseProvider,
    setMarketBrowseProvider,
    builtinTabStats,
    userTabStats,
    detailEnabled,
    filteredCatalog,
    builtinCategories,
    categoryFilteredCatalog,
    filterLabel,
    inSettingsShell,
    categoryLabel,
    onReloadClick,
    openSkillDetail,
    openMarketplaceDetail,
    onSkillToggle,
    onInstallSubmit,
    onFileInputChange,
    onModalDragOver,
    onModalDragLeave,
    onModalDrop,
    sourceLabel,
    runDelete,
    onMarketInstall,
    isSkillInstalledByName,
  };
}

export type SkillsPageVm = ReturnType<typeof useSkillsPage>;
