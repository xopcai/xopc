import { useEffect, useRef } from 'react';

import { FindSkillsButton } from '@/features/skills/find-skills-button';
import { Button } from '@/components/ui/button';
import { PageTabs } from '@/components/ui/page-tabs';
import { MarketplaceSkillCardSkeleton } from '@/features/skills/skills-page-primitives';
import { SKILL_LIST_SKELETON_KEYS } from '@/features/skills/skills-page.constants';
import {
  interpolate,
  marketplacePackageRequestName,
} from '@/features/skills/skills-page.utils';
import type { SkillsPageVm } from '@/features/skills/use-skills-page';
import { SkillGridCard, skillCardActionClassName } from '@/features/skills/skill-grid-card';

type Props = Pick<
  SkillsPageVm,
  | 'sk'
  | 'onFindSkills'
  | 'findingSkills'
  | 'mpCategories'
  | 'mpCategoriesLoading'
  | 'mpCategoriesError'
  | 'mpPayload'
  | 'mpLoading'
  | 'mpError'
  | 'marketCategoryId'
  | 'setMarketCategoryId'
  | 'mpHasMore'
  | 'onLoadMoreMarket'
  | 'onRetryMarket'
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
  | 'marketplacePresentation'
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
    mpHasMore,
    onLoadMoreMarket,
    onRetryMarket,
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
    marketplacePresentation,
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

  const sentinelRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const sentinel = sentinelRef.current;
    if (!sentinel || !mpHasMore || mpLoading || mpError) return;
    const observer = new IntersectionObserver((entries) => {
      if (entries.some((entry) => entry.isIntersecting)) onLoadMoreMarket();
    }, { rootMargin: '200px' });
    observer.observe(sentinel);
    return () => observer.disconnect();
  }, [mpHasMore, mpLoading, mpError, onLoadMoreMarket]);

  return (
    <>
      {!showCategories ? null : mpCategories.length > 0 ? (
        <PageTabs
          items={categoryTabItems}
          activeTab={marketCategoryId}
          onChange={setMarketCategoryId}
          ariaLabel={sk.marketplaceCategoriesAria}
          tabIdPrefix="skills-marketplace-category-tab"
          className="min-h-[2.75rem] items-center gap-2 pt-0.5 [scrollbar-width:none] [&::-webkit-scrollbar]:hidden"
          buttonClassName="max-w-[14rem] truncate rounded-md px-3 py-1.5 text-xs"
          selectedClassName="bg-surface-active font-medium text-fg"
          unselectedClassName="text-fg-muted hover:bg-surface-hover hover:text-fg"
        />
      ) : mpCategoriesLoading ? (
        <div className="-mx-1 flex min-h-[2.75rem] items-center gap-2 overflow-x-auto px-1 pb-1 pt-0.5 [scrollbar-width:none] [&::-webkit-scrollbar]:hidden" aria-hidden>
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
          <p>{mpError}</p>
          <Button className="mt-2" onClick={onRetryMarket}>{sk.marketplaceRetry}</Button>
        </div>
      ) : mpPayload ? (
        <div className="relative">
          {mpPayload.items.length === 0 ? (
            <div className="flex flex-col items-center gap-3 py-12 text-center text-sm text-fg-muted">
              <p className="px-4">
                {searchInputActive && trimmedQuery
                  ? interpolate(sk.marketplaceEmptySearch, { query: trimmedQuery })
                  : sk.marketplaceEmpty}
              </p>
              <FindSkillsButton sk={sk} findingSkills={p.findingSkills} onFindSkills={p.onFindSkills} secondary />
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
            <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3">
              {mpPayload.items.map((row) => {
                const presentation = marketplacePresentation(row);
                const provider = row.providerId ?? marketBrowseProvider;
                const packageName = marketplacePackageRequestName(row, provider);
                const installed = isSkillInstalledByName(packageName);
                const categoryId = row.category ?? row.categories?.[0];
                return (
                  <SkillGridCard
                    key={row.id}
                    name={presentation.displayName}
                    description={presentation.description}
                    category={categoryId ?? undefined}
                    iconUrl={row.branding?.iconUrl}
                    metadata={
                      <span title={`${sk.marketplaceAuthor}: ${row.author.username} · ${sk.marketplaceDownloads}: ${row.downloads}${row.latestVersion ? ` · ${sk.marketplaceVersion}: ${row.latestVersion}` : ''}${row.stars ? ` · ${sk.marketplaceStars}: ${row.stars}` : ''}`}>
                        {row.author.username} · {sk.marketplaceDownloads} {row.downloads.toLocaleString()}
                      </span>
                    }
                    onOpen={() => void openMarketplaceDetail(packageName, row.name, row.providerId ?? undefined)}
                    action={
                      <Button
                        type="button"
                        variant="secondary"
                        className={skillCardActionClassName}
                        aria-label={`${installed ? sk.previewUseInChat : sk.marketplaceInstall} ${presentation.displayName}`}
                        disabled={installingMarketName === packageName || usingSkillInChatName === packageName}
                        onClick={() => {
                          if (installed) {
                            void onUseSkillInChat({ name: packageName, source: 'store', providerOverride: row.providerId ?? null });
                          } else {
                            void onMarketInstall(packageName, { providerOverride: row.providerId ?? null });
                          }
                        }}
                      >
                        {installingMarketName === packageName
                          ? sk.uploading
                          : usingSkillInChatName === packageName
                            ? sk.previewUseInChatBusy
                            : installed ? sk.previewUseInChat : sk.marketplaceInstall}
                      </Button>
                    }
                  />
                );
              })}
            </div>
          )}
          <div ref={sentinelRef} className="h-1" aria-hidden />
          {mpLoading ? (
            <div className="mt-3 grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3" aria-busy="true" aria-label={sk.loading}>
              {SKILL_LIST_SKELETON_KEYS.slice(0, 3).map((key) => <MarketplaceSkillCardSkeleton key={key} />)}
            </div>
          ) : mpError ? (
            <div className="mt-4 text-center" role="alert">
              <p className="mb-2 text-sm text-fg-muted">{mpError}</p>
              <Button onClick={onRetryMarket}>{sk.marketplaceRetry}</Button>
            </div>
          ) : !mpHasMore && mpPayload.items.length > 0 ? (
            <p className="mt-4 text-center text-xs text-fg-subtle">{searchInputActive ? sk.marketplaceSearchEnd : sk.marketplaceEnd}</p>
          ) : null}
        </div>
      ) : null}
    </>
  );
}
