import { CheckCircle2, ChevronLeft, ChevronRight, Loader2, Star } from 'lucide-react';

import { Button } from '@/components/ui/button';
import { PageTabs } from '@/components/ui/page-tabs';
import { MarketplaceSkillCardSkeleton } from '@/features/skills/skills-page-primitives';
import { SKILL_LIST_SKELETON_KEYS } from '@/features/skills/skills-page.constants';
import {
  interpolate,
  marketplacePackageRequestName,
} from '@/features/skills/skills-page.utils';
import type { SkillsPageVm } from '@/features/skills/use-skills-page';
import { cn } from '@/lib/cn';
import { interaction } from '@/lib/interaction';

type Props = Pick<
  SkillsPageVm,
  | 'sk'
  | 'mpCategories'
  | 'mpCategoriesLoading'
  | 'mpCategoriesError'
  | 'mpPayload'
  | 'mpLoading'
  | 'mpError'
  | 'marketCategoryId'
  | 'setMarketCategoryId'
  | 'marketPage'
  | 'setMarketPage'
  | 'isSkillInstalledByName'
  | 'openMarketplaceDetail'
  | 'onMarketInstall'
  | 'installingMarketName'
  | 'onUseSkillInChat'
  | 'usingSkillInChatName'
  | 'searchInputActive'
  | 'searchQuery'
  | 'setSearchQuery'
  | 'registeredProviders'
  | 'marketBrowseProvider'
  | 'setMarketBrowseProvider'
>;

export function SkillsPageMarketplaceContent(p: Props) {
  const {
    sk,
    mpCategories,
    mpCategoriesLoading,
    mpCategoriesError,
    mpPayload,
    mpLoading,
    mpError,
    marketCategoryId,
    setMarketCategoryId,
    marketPage,
    setMarketPage,
    isSkillInstalledByName,
    openMarketplaceDetail,
    onMarketInstall,
    installingMarketName,
    onUseSkillInChat,
    usingSkillInChatName,
    searchInputActive,
    searchQuery,
    setSearchQuery,
    registeredProviders,
    marketBrowseProvider,
    setMarketBrowseProvider,
  } = p;
  const showCategories = !searchInputActive;
  const otherProviders = registeredProviders.filter((rp) => rp.id !== marketBrowseProvider);
  const trimmedQuery = searchQuery.trim();
  const categoryTabItems = [
    { id: '', label: sk.marketplaceCategoryAll },
    ...mpCategories.map((c) => ({ id: c.id, label: c.label, title: c.label })),
  ];
  const categoryLabels = new Map(mpCategories.map((category) => [category.id, category.label]));

  return (
    <>
      {!showCategories ? null : mpCategories.length > 0 ? (
        <PageTabs
          items={categoryTabItems}
          activeTab={marketCategoryId}
          onChange={setMarketCategoryId}
          ariaLabel={sk.marketplaceCategoriesAria}
          tabIdPrefix="skills-marketplace-category-tab"
          className="min-h-[2.75rem] items-center gap-2 pt-0.5 [scrollbar-width:thin]"
          buttonClassName="max-w-[14rem] truncate rounded-full border px-3 py-1.5 text-xs"
          selectedClassName="border-fg bg-fg text-surface-panel dark:border-fg dark:bg-fg dark:text-surface-base"
          unselectedClassName="border-edge bg-surface-panel text-fg-muted hover:border-edge-strong hover:text-fg dark:border-edge dark:bg-surface-hover/40"
        />
      ) : mpCategoriesLoading ? (
        <div className="-mx-1 flex min-h-[2.75rem] items-center gap-2 overflow-x-auto px-1 pb-1 pt-0.5 [scrollbar-width:thin]" aria-hidden>
          {(['p0', 'p1', 'p2', 'p3', 'p4'] as const).map((k) => (
            <div
              key={k}
              className="h-8 w-[4.5rem] shrink-0 animate-pulse rounded-full bg-surface-hover motion-reduce:animate-none dark:bg-surface-active/50"
            />
          ))}
        </div>
      ) : null}
      {showCategories && mpCategoriesError ? (
        <p className="text-xs text-red-600 dark:text-red-400" role="alert">
          {mpCategoriesError}
        </p>
      ) : null}
      {!mpPayload && !mpError ? (
        <div
          className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3"
          aria-busy="true"
          aria-label={sk.loading}
        >
          {SKILL_LIST_SKELETON_KEYS.map((k) => (
            <MarketplaceSkillCardSkeleton key={k} />
          ))}
        </div>
      ) : mpError && !mpPayload ? (
        <div
          className="rounded-xl border border-edge bg-red-50 px-3 py-2 text-sm text-red-700 dark:border-edge dark:bg-red-950/40 dark:text-red-300"
          role="alert"
        >
          {mpError}
        </div>
      ) : mpPayload ? (
        <div className="relative">
          {mpLoading ? (
            <div
              className="pointer-events-none absolute inset-0 z-[1] flex justify-center bg-surface-panel/40 pt-[min(28vh,7.5rem)] backdrop-blur-[1px] motion-reduce:backdrop-blur-none dark:bg-surface-base/35"
              aria-busy="true"
              aria-label={sk.loading}
            >
              <Loader2
                className="size-8 shrink-0 animate-spin text-accent motion-reduce:animate-none"
                strokeWidth={2}
                aria-hidden
              />
            </div>
          ) : null}
          {mpPayload.items.length === 0 ? (
            <div className="flex flex-col items-center gap-3 rounded-2xl border border-dashed border-edge py-12 text-center text-sm text-fg-muted">
              <p className="px-4">
                {searchInputActive && trimmedQuery
                  ? interpolate(sk.marketplaceEmptySearch, { query: trimmedQuery })
                  : sk.marketplaceEmpty}
              </p>
              {searchInputActive ? (
                <div className="flex flex-wrap items-center justify-center gap-2">
                  {otherProviders.map((rp) => (
                    <Button
                      key={rp.id}
                      type="button"
                      variant="secondary"
                      className="h-8 px-3 text-xs"
                      onClick={() => setMarketBrowseProvider(rp.id)}
                    >
                      {interpolate(sk.marketplaceEmptySearchTryProvider, {
                        provider: rp.displayName,
                      })}
                    </Button>
                  ))}
                  <Button
                    type="button"
                    variant="ghost"
                    className="h-8 px-3 text-xs"
                    onClick={() => setSearchQuery('')}
                  >
                    {sk.marketplaceEmptySearchClear}
                  </Button>
                </div>
              ) : null}
            </div>
          ) : (
            <div
              className={cn(
                'grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3',
                mpLoading && 'pointer-events-none opacity-[0.52] motion-reduce:opacity-100',
              )}
            >
              {mpPayload.items.map((row) => {
                const provider = row.providerId ?? marketBrowseProvider;
                const packageName = marketplacePackageRequestName(row, provider);
                const installed = isSkillInstalledByName(packageName);
                const categoryId = row.category ?? row.categories?.[0];
                const categoryLabel = categoryId ? categoryLabels.get(categoryId) ?? categoryId : null;
                return (
                  <article
                    key={row.id}
                    className={cn(
                      'group flex h-full flex-col rounded-xl bg-surface-panel p-4 shadow-surface',
                      'transition-colors hover:bg-surface-hover',
                    )}
                  >
                    <div className="flex items-start justify-between gap-2">
                      <button
                        type="button"
                        className={cn(
                          'min-w-0 flex-1 rounded-lg text-left outline-none',
                          interaction.focusRingPanel,
                        )}
                        onClick={() =>
                          void openMarketplaceDetail(packageName, row.name, row.providerId ?? undefined)
                        }
                      >
                        <h3
                          id={`mp-skill-title-${row.id}`}
                          className="truncate text-[15px] font-semibold leading-snug tracking-tight text-fg"
                        >
                          {row.name}
                        </h3>
                      </button>
                      {!installed ? (
                        <Button
                          type="button"
                          variant="primary"
                          className="h-8 shrink-0 whitespace-nowrap px-2.5 text-xs font-medium"
                          disabled={mpLoading || installingMarketName === packageName}
                          onClick={() =>
                            void onMarketInstall(packageName, {
                              providerOverride: row.providerId ?? null,
                            })
                          }
                        >
                          {installingMarketName === packageName ? sk.uploading : sk.marketplaceInstall}
                        </Button>
                      ) : (
                        <span className="inline-flex shrink-0 items-center gap-1 rounded-full border border-emerald-500/30 bg-emerald-500/10 px-2 py-0.5 text-[11px] font-medium text-emerald-700 dark:text-emerald-300">
                          <CheckCircle2 className="size-3" aria-hidden />
                          {sk.marketplaceInstalled}
                        </span>
                      )}
                    </div>
                    <button
                      type="button"
                      className={cn(
                        'mt-2 flex min-h-0 w-full flex-1 cursor-pointer flex-col rounded-lg text-left outline-none',
                        interaction.focusRingPanel,
                      )}
                      aria-labelledby={`mp-skill-title-${row.id}`}
                      onClick={() =>
                        void openMarketplaceDetail(packageName, row.name, row.providerId ?? undefined)
                      }
                    >
                      <div className="flex items-start gap-3">
                        <div className="flex min-w-0 flex-1 flex-col gap-2">
                          <p
                            className="line-clamp-2 text-sm leading-relaxed text-fg-muted"
                            title={row.description ? row.description : undefined}
                          >
                            {row.description || '—'}
                          </p>
                          {categoryLabel ? (
                            <span className="w-fit max-w-full truncate rounded-full bg-surface-subtle px-2 py-0.5 text-[10px] font-medium text-fg-muted">
                              {categoryLabel}
                            </span>
                          ) : null}
                          <div className="mt-auto min-h-[2.625rem] space-y-1 text-[11px] leading-snug text-fg-muted">
                            <p
                              className="line-clamp-1"
                              title={`${sk.marketplaceAuthor}: ${row.author.username} · ${sk.marketplaceDownloads}: ${row.downloads}${
                                row.stars != null && row.stars > 0 ? ` · ★${row.stars}` : ''
                              }${installed ? ` · ${sk.marketplaceInstalled}` : ''}`}
                            >
                              <span className="text-fg-subtle">{sk.marketplaceAuthor}</span>{' '}
                              <span className="text-fg">{row.author.username}</span>
                              <span className="text-fg-subtle"> · </span>
                              <span>
                                {sk.marketplaceDownloads}: {row.downloads}
                              </span>
                              {row.stars != null && row.stars > 0 ? (
                                <>
                                  <span className="text-fg-subtle"> · </span>
                                  <span className="inline-flex items-center gap-0.5 text-fg-muted">
                                    <Star
                                      className="size-3 shrink-0 text-amber-600 dark:text-amber-400"
                                      strokeWidth={2}
                                      aria-hidden
                                    />
                                    {row.stars}
                                  </span>
                                </>
                              ) : null}
                            </p>
                            {row.latestVersion ? (
                              <p
                                className="line-clamp-1 min-h-[1.125rem] font-mono text-[10px] text-fg-subtle"
                                title={`${sk.marketplaceVersion}: ${row.latestVersion}`}
                              >
                                {sk.marketplaceVersion}: {row.latestVersion}
                              </p>
                            ) : null}
                          </div>
                        </div>
                      </div>
                    </button>
                    {installed ? (
                      <div
                        role="group"
                        className="mt-3 flex items-center justify-end gap-1 border-t border-edge-subtle pt-3"
                      >
                        <Button
                          type="button"
                          variant="secondary"
                          className="h-8 shrink-0 whitespace-nowrap px-2.5 text-xs font-medium"
                          disabled={mpLoading || usingSkillInChatName === packageName}
                          onClick={() =>
                            void onUseSkillInChat({
                              name: packageName,
                              source: 'store',
                              providerOverride: row.providerId ?? null,
                            })
                          }
                        >
                          {usingSkillInChatName === packageName
                            ? sk.previewUseInChatBusy
                            : sk.previewUseInChat}
                        </Button>
                      </div>
                    ) : null}
                  </article>
                );
              })}
            </div>
          )}
          {mpPayload.items.length > 0 ? (
            <div className="mt-3 flex flex-col items-center justify-between gap-3 sm:flex-row">
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
                  onClick={() => setMarketPage((pg) => Math.max(1, pg - 1))}
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
                  onClick={() => setMarketPage((pg) => Math.min(mpPayload.meta.totalPages, pg + 1))}
                >
                  <span className="sr-only sm:not-sr-only">{sk.marketplacePageNext}</span>
                  <ChevronRight className="size-4" strokeWidth={1.75} aria-hidden />
                </Button>
              </div>
            </div>
          ) : null}
        </div>
      ) : null}
    </>
  );
}
