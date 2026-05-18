import { ChevronLeft, ChevronRight, ExternalLink, Loader2, Star } from 'lucide-react';

import { Button } from '@/components/ui/button';
import { SkillCardIcon } from '@/features/skills/skill-card-icon';
import { MarketplaceSkillCardSkeleton } from '@/features/skills/skills-page-primitives';
import { SKILL_LIST_SKELETON_KEYS } from '@/features/skills/skills-page.constants';
import { interpolate, skillHubPublicSkillPageUrl } from '@/features/skills/skills-page.utils';
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
  | 'marketBrowseProvider'
  | 'marketPage'
  | 'setMarketPage'
  | 'installingMarketName'
  | 'isSkillInstalledByName'
  | 'onMarketInstall'
  | 'openMarketplaceDetail'
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
    marketBrowseProvider,
    marketPage,
    setMarketPage,
    installingMarketName,
    isSkillInstalledByName,
    onMarketInstall,
    openMarketplaceDetail,
  } = p;

  return (
    <>
      <div
        className={cn(
          '-mx-1 flex min-h-[2.75rem] items-center gap-2 overflow-x-auto px-1 pb-1 pt-0.5 [scrollbar-width:thin]',
          !mpCategoriesLoading && mpCategories.length === 0 && 'min-h-0 pb-0 pt-0',
        )}
        role={mpCategories.length > 0 || mpCategoriesLoading ? 'tablist' : undefined}
        aria-label={mpCategories.length > 0 || mpCategoriesLoading ? sk.marketplaceCategoriesAria : undefined}
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
            {(['p0', 'p1', 'p2', 'p3', 'p4'] as const).map((k) => (
              <div
                key={k}
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
            <div className="rounded-2xl border border-dashed border-edge py-16 text-center text-sm text-fg-muted">
              {sk.marketplaceEmpty}
            </div>
          ) : (
            <div
              className={cn(
                'grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3',
                mpLoading && 'pointer-events-none opacity-[0.52] motion-reduce:opacity-100',
              )}
            >
              {mpPayload.items.map((row) => {
                const installed = isSkillInstalledByName(row.id);
                const busy = installingMarketName === row.id;
                const skillhubPageUrl =
                  marketBrowseProvider === 'skillhub' ? skillHubPublicSkillPageUrl(row.id) : null;
                return (
                  <article
                    key={row.id}
                    className={cn(
                      'group flex h-full flex-col rounded-xl border border-edge-subtle bg-surface-base p-4',
                      'transition-colors hover:border-accent/40 hover:bg-surface-hover',
                      'dark:border-edge-subtle',
                    )}
                  >
                    <div
                      role="button"
                      tabIndex={0}
                      className={cn(
                        'flex min-h-0 flex-1 cursor-pointer flex-col rounded-lg text-left outline-none',
                        interaction.focusRingPanel,
                      )}
                      aria-labelledby={`mp-skill-title-${row.id}`}
                      onClick={(e) => {
                        const el = e.target as HTMLElement;
                        if (el.closest('a[href]') || el.closest('button')) return;
                        void openMarketplaceDetail(row.id, row.name);
                      }}
                      onKeyDown={(e) => {
                        const el = e.target as HTMLElement;
                        if (el.closest('a[href]') || el.closest('button')) return;
                        if (e.key === 'Enter' || e.key === ' ') {
                          e.preventDefault();
                          void openMarketplaceDetail(row.id, row.name);
                        }
                      }}
                    >
                      <div className="flex items-start gap-3">
                        <SkillCardIcon name={row.id} />
                        <div className="flex min-w-0 flex-1 flex-col gap-2">
                          <div className="flex items-start justify-between gap-2">
                            <h3
                              id={`mp-skill-title-${row.id}`}
                              className="min-w-0 flex-1 truncate text-[15px] font-semibold leading-snug tracking-tight text-fg"
                            >
                              {row.name}
                            </h3>
                            <div className="flex shrink-0 items-center gap-1">
                              {skillhubPageUrl ? (
                                <a
                                  href={skillhubPageUrl}
                                  target="_blank"
                                  rel="noopener noreferrer"
                                  className={cn(
                                    'inline-flex size-8 shrink-0 items-center justify-center rounded-lg border border-edge bg-surface-panel text-fg-muted',
                                    'hover:bg-surface-hover hover:text-fg dark:border-edge',
                                    interaction.focusRingPanel,
                                  )}
                                  aria-label={sk.marketplaceOpenOnSkillhubAria}
                                  title={sk.marketplaceOpenOnSkillhub}
                                >
                                  <ExternalLink className="size-3.5" strokeWidth={2} aria-hidden />
                                </a>
                              ) : null}
                              <div
                                role="group"
                                className="inline-flex shrink-0"
                                onClick={(e) => e.stopPropagation()}
                                onKeyDown={(e) => e.stopPropagation()}
                              >
                                <Button
                                  type="button"
                                  variant="secondary"
                                  className="h-8 shrink-0 whitespace-nowrap px-2.5 text-xs font-medium"
                                  disabled={busy || mpLoading}
                                  onClick={() => void onMarketInstall(row.id)}
                                >
                                  {busy
                                    ? sk.uploading
                                    : installed
                                      ? sk.marketplaceReinstall
                                      : sk.marketplaceInstall}
                                </Button>
                              </div>
                            </div>
                          </div>
                          <p
                            className="line-clamp-2 text-sm leading-relaxed text-fg-muted"
                            title={row.description ? row.description : undefined}
                          >
                            {row.description || '—'}
                          </p>
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
                              {installed ? (
                                <>
                                  <span className="text-fg-subtle"> · </span>
                                  <span className="text-emerald-700 dark:text-emerald-400">
                                    {sk.marketplaceInstalled}
                                  </span>
                                </>
                              ) : null}
                            </p>
                            <p
                              className="line-clamp-1 min-h-[1.125rem] font-mono text-[10px] text-fg-subtle"
                              title={
                                [
                                  row.latestVersion ? `${sk.marketplaceVersion}: ${row.latestVersion}` : '',
                                  row.sourceLabel ? `${sk.marketplaceSource}: ${row.sourceLabel}` : '',
                                ]
                                  .filter(Boolean)
                                  .join(' · ') || undefined
                              }
                            >
                              {row.latestVersion ? (
                                <>
                                  {sk.marketplaceVersion}: {row.latestVersion}
                                </>
                              ) : null}
                              {row.latestVersion && row.sourceLabel ? (
                                <span className="text-fg-subtle"> · </span>
                              ) : null}
                              {row.sourceLabel ? (
                                <>
                                  {sk.marketplaceSource}: {row.sourceLabel}
                                </>
                              ) : null}
                            </p>
                          </div>
                        </div>
                      </div>
                    </div>
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
