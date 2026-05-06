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
  Star,
  Trash2,
  X,
} from 'lucide-react';
import { useLayoutEffect, useMemo } from 'react';

import { MarkdownView } from '@/components/markdown/markdown-view';
import { Button } from '@/components/ui/button';
import { cn } from '@/lib/cn';
import { interaction } from '@/lib/interaction';
import { SkillCardIcon } from '@/features/skills/skill-card-icon';
import { SkillCatalogStructuredPreview } from '@/features/skills/skill-catalog-structured-preview';
import { SkillsPageHeaderEnd } from '@/features/skills/skills-page-header-end';
import {
  MarketplaceSkillListRowSkeleton,
  SkillEnableSwitch,
  SkillListRowSkeleton,
} from '@/features/skills/skills-page-primitives';
import { SKILL_LIST_SKELETON_COUNT } from '@/features/skills/skills-page.constants';
import { interpolate } from '@/features/skills/skills-page.utils';
import type { SkillsPageVm } from '@/features/skills/use-skills-page';
import { usePageHeaderStore } from '@/stores/page-header-store';

export function SkillsPageView({ vm }: { vm: SkillsPageVm }) {
  const {
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
    marketCategoryId,
    setMarketCategoryId,
    mpCategories,
    mpCategoriesError,
    mpCategoriesLoading,
    marketplaceProviderId,
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
  } = vm;

  const setPageHeader = usePageHeaderStore((s) => s.setPageHeader);
  const clearPageHeader = usePageHeaderStore((s) => s.clearPageHeader);

  const skillsHeaderEnd = useMemo(
    () => (
      <SkillsPageHeaderEnd
        loading={loading}
        onReloadClick={onReloadClick}
        searchQuery={searchQuery}
        setSearchQuery={setSearchQuery}
        mainTab={mainTab}
        sk={sk}
        setPendingFile={setPendingFile}
        setInstallOpen={setInstallOpen}
      />
    ),
    [
      loading,
      onReloadClick,
      searchQuery,
      setSearchQuery,
      mainTab,
      sk,
      setPendingFile,
      setInstallOpen,
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
            <div
              className="flex flex-wrap gap-x-1 gap-y-1"
              role="tablist"
              aria-label={sk.skillsNavAria}
            >
              <button
                type="button"
                role="tab"
                aria-selected={mainTab === 'marketplace'}
                className={cn(
                  'relative max-w-full rounded-md px-3 py-2 text-left text-sm font-medium transition-colors sm:text-center',
                  mainTab === 'marketplace' ? 'text-fg' : 'text-fg-muted hover:text-fg',
                  mainTab === 'marketplace' &&
                    'after:absolute after:bottom-0 after:left-1/2 after:h-0.5 after:w-9 after:-translate-x-1/2 after:rounded-full after:bg-accent',
                )}
                onClick={() => setMainTab('marketplace')}
              >
                {sk.tabMarketplace}
                {marketplaceProviderId ? (
                  <span className="font-normal text-fg-muted">({marketplaceProviderId})</span>
                ) : null}
              </button>
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
            </div>
            <div
              className={cn(
                'flex min-h-9 min-w-0 items-center gap-2',
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
              {mainTab === 'builtin' ? (
                <div className="h-9 min-w-[9rem] shrink-0" aria-hidden />
              ) : null}
            </div>
          </div>

          {mainTab === 'marketplace' ? (
            <>
              <div
                className={cn(
                  '-mx-1 flex min-h-[2.75rem] items-center gap-2 overflow-x-auto px-1 pb-1 pt-0.5 [scrollbar-width:thin]',
                  !mpCategoriesLoading && mpCategories.length === 0 && 'min-h-0 pb-0 pt-0',
                )}
                role={mpCategories.length > 0 || mpCategoriesLoading ? 'tablist' : undefined}
                aria-label={
                  mpCategories.length > 0 || mpCategoriesLoading ? sk.marketplaceCategoriesAria : undefined
                }
              >
                {mpCategories.length > 0 ? (
                  <>
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
                  </>
                ) : mpCategoriesLoading ? (
                  <div className="flex gap-2 px-1" aria-hidden>
                    {Array.from({ length: 5 }, (_, i) => (
                      <div
                        key={i}
                        className="h-8 w-[4.5rem] shrink-0 animate-pulse rounded-full bg-surface-hover motion-reduce:animate-none dark:bg-surface-active/50"
                      />
                    ))}
                  </div>
                ) : null}
              </div>
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
                    <MarketplaceSkillListRowSkeleton key={i} />
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
                            onClick={() => void openMarketplaceDetail(row.id, row.name)}
                          >
                            <SkillCardIcon name={row.id} />
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
                <>
                  {builtinCategories.length > 1 ? (
                    <div
                      role="tablist"
                      aria-label={sk.marketplaceCategoriesAria}
                      className="-mx-1 flex gap-2 overflow-x-auto px-1 pb-1 pt-0.5 [scrollbar-width:thin]"
                    >
                      <button
                        type="button"
                        role="tab"
                        aria-selected={builtinCategoryFilter === ''}
                        className={cn(
                          'shrink-0 rounded-full border px-3 py-1.5 text-xs font-medium transition-colors',
                          interaction.focusRingPanel,
                          builtinCategoryFilter === ''
                            ? 'border-fg bg-fg text-surface-panel dark:border-fg dark:bg-fg dark:text-surface-base'
                            : 'border-edge bg-surface-panel text-fg-muted hover:border-edge-strong hover:text-fg dark:border-edge dark:bg-surface-hover/40',
                        )}
                        onClick={() => setBuiltinCategoryFilter('')}
                      >
                        {sk.marketplaceCategoryAll}
                      </button>
                      {builtinCategories.map((cat) => {
                        const selected = builtinCategoryFilter === cat;
                        return (
                          <button
                            key={cat}
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
                            title={categoryLabel(cat)}
                            onClick={() => setBuiltinCategoryFilter(cat)}
                          >
                            {categoryLabel(cat)}
                          </button>
                        );
                      })}
                    </div>
                  ) : null}
                  {categoryFilteredCatalog.length === 0 ? (
                    <div className="rounded-2xl border border-dashed border-edge py-16 text-center text-sm text-fg-muted">
                      {sk.noSearchResults}
                    </div>
                  ) : (
                    <div className="overflow-hidden rounded-2xl border border-edge-subtle bg-surface-base dark:border-edge-subtle">
                      {categoryFilteredCatalog.map((row, i, arr) => (
                        <article
                          key={`${row.directoryId}-${row.path}`}
                          className={cn(
                            'group relative flex items-center gap-4 border-b border-edge-subtle px-4 py-3.5',
                            i === arr.length - 1 && 'border-b-0',
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
            </>
          )}
        </section>
      </div>

      <Dialog.Root
        open={detailOpen}
        onOpenChange={(open) => {
          setDetailOpen(open);
          if (!open) {
            setDetailSource('catalog');
            setDetailMarkdown('');
            setDetailCatalogPreview(null);
            setDetailMarketplacePreview(null);
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
                {detailSource === 'store' && detailMarketplacePreview
                  ? sk.detailModalBanner
                  : detailSource === 'store'
                    ? sk.detailModalBannerStore
                    : sk.detailModalBanner}
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
              ) : detailSource === 'catalog' && detailCatalogPreview ? (
                <SkillCatalogStructuredPreview preview={detailCatalogPreview} sk={sk} />
              ) : detailSource === 'store' && detailMarketplacePreview ? (
                <SkillCatalogStructuredPreview preview={detailMarketplacePreview} sk={sk} />
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
