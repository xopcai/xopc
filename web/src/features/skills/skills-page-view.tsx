import * as DropdownMenu from '@radix-ui/react-dropdown-menu';
import { ChevronDown, Funnel } from 'lucide-react';
import { useLayoutEffect, useMemo } from 'react';

import { SkillsMarketplaceConfigSection } from '@/features/skills/skills-marketplace-config-section';
import { SkillsPageHeaderEnd } from '@/features/skills/skills-page-header-end';
import { SkillsPageCatalogContent } from '@/features/skills/skills-page-catalog-content';
import { SkillsPageConfirmDialog } from '@/features/skills/skills-page-confirm-dialog';
import { SkillsPageDetailDialog } from '@/features/skills/skills-page-detail-dialog';
import { SkillsPageInstallDialog } from '@/features/skills/skills-page-install-dialog';
import { SkillsPageMarketplaceContent } from '@/features/skills/skills-page-marketplace-content';
import type { SkillsPageVm } from '@/features/skills/use-skills-page';
import { cn } from '@/lib/cn';
import { interaction } from '@/lib/interaction';
import { usePageHeaderStore } from '@/stores/page-header-store';

export function SkillsPageView({ vm }: { vm: SkillsPageVm }) {
  const {
    sk,
    hasToken,
    error,
    searchQuery,
    setSearchQuery,
    actionFeedback,
    mainTab,
    setMainTab,
    setSourceFilter,
    loading,
    onReloadClick,
    setPendingFile,
    setInstallOpen,
    builtinTabStats,
    userTabStats,
    marketSort,
    setMarketSort,
    marketBrowseProvider,
    setMarketBrowseProvider,
    registeredProviders,
    filterLabel,
    inSettingsShell,
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
    [loading, onReloadClick, searchQuery, setSearchQuery, mainTab, sk, setPendingFile, setInstallOpen],
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
    <div className="flex min-h-0 min-w-0 flex-1 flex-col bg-surface-panel">
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

        <SkillsMarketplaceConfigSection hasToken={hasToken} />

        {inSettingsShell ? (
          <div className="flex flex-col gap-3 border-b border-edge-subtle pb-4 dark:border-edge-subtle sm:flex-row sm:flex-wrap sm:items-center sm:justify-end">
            {skillsHeaderEnd}
          </div>
        ) : null}

        <section className="flex flex-col gap-4">
          <div className="flex flex-col gap-3 border-b border-edge-subtle pb-3 sm:flex-row sm:items-center sm:justify-between dark:border-edge-subtle">
            <div className="flex flex-wrap gap-x-1 gap-y-1" role="tablist" aria-label={sk.skillsNavAria}>
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
                <>
                  <div
                    className="inline-flex h-9 shrink-0 rounded-lg border border-edge bg-surface-panel p-0.5 shadow-surface"
                    role="group"
                    aria-label={sk.marketplaceBrowseSwitchAria}
                  >
                    {registeredProviders.map((p) => {
                      const selected = marketBrowseProvider === p.id;
                      return (
                        <button
                          key={p.id}
                          type="button"
                          className={cn(
                            'rounded-md px-2.5 py-1.5 text-xs font-medium transition-colors',
                            interaction.focusRingPanel,
                            selected
                              ? 'bg-fg text-surface-panel dark:bg-fg dark:text-surface-base'
                              : 'text-fg-muted hover:text-fg',
                          )}
                          aria-pressed={selected}
                          onClick={() => setMarketBrowseProvider(p.id)}
                        >
                          {p.displayName}
                        </button>
                      );
                    })}
                  </div>
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
                </>
              ) : null}
              {mainTab === 'builtin' ? <div className="h-9 min-w-[9rem] shrink-0" aria-hidden /> : null}
            </div>
          </div>

          {mainTab === 'marketplace' ? (
            <SkillsPageMarketplaceContent {...vm} />
          ) : (
            <SkillsPageCatalogContent {...vm} />
          )}
        </section>
      </div>

      <SkillsPageDetailDialog {...vm} />
      <SkillsPageInstallDialog {...vm} />
      <SkillsPageConfirmDialog {...vm} />
    </div>
  );
}
