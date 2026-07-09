import * as DropdownMenu from '@radix-ui/react-dropdown-menu';
import { ChevronDown, Funnel } from 'lucide-react';
import { useLayoutEffect, useMemo } from 'react';

import { PageTabs } from '@/components/ui/page-tabs';
import { SkillsPageHeaderEnd } from '@/features/skills/skills-page-header-end';
import { SkillsPageCatalogContent } from '@/features/skills/skills-page-catalog-content';
import { SkillsPageConfirmDialog } from '@/features/skills/skills-page-confirm-dialog';
import { SkillsPageDetailDialog } from '@/features/skills/skills-page-detail-dialog';
import { SkillsPageInstallDialog } from '@/features/skills/skills-page-install-dialog';
import { SkillsPageMarketplaceContent } from '@/features/skills/skills-page-marketplace-content';
import { interpolate } from '@/features/skills/skills-page.utils';
import type { SkillsPageVm } from '@/features/skills/use-skills-page';
import { cn } from '@/lib/cn';
import { interaction } from '@/lib/interaction';
import { usePageHeaderStore } from '@/stores/page-header-store';

export function SkillsPageView({ vm }: { vm: SkillsPageVm }) {
  const {
    sk,
    hasToken,
    error,
    actionFeedback,
    skillDiagnostics,
    mainTab,
    setMainTab,
    setSourceFilter,
    builtinTabStats,
    userTabStats,
    catalogDisabledCount,
    catalogStatusFilter,
    setCatalogStatusFilter,
    marketSort,
    setMarketSort,
    marketBrowseProvider,
    setMarketBrowseProvider,
    registeredProviders,
    filterLabel,
    inSettingsShell,
    searchInputActive,
    resultTab,
    setResultTab,
    aggregatedTabCounts,
    aggregatedProviderStatus,
  } = vm;

  if (!hasToken) {
    return (
      <>
        <SkillsPageHeaderRegistration vm={vm} />
        <div className="w-full px-3 py-16 text-center text-sm text-fg-muted sm:px-5 xl:px-6">
          {sk.needToken}
        </div>
      </>
    );
  }

  const mainTabItems = [
    { id: 'marketplace' as const, label: sk.tabMarketplace },
    { id: 'builtin' as const, label: sk.tabBuiltin, count: `${builtinTabStats.enabled}/${builtinTabStats.total}` },
    { id: 'user' as const, label: sk.tabUser, count: `${userTabStats.enabled}/${userTabStats.total}` },
  ];
  const resultTabItems = (['all', ...registeredProviders.map((rp) => rp.id)] as string[]).map((id) => {
    const label = id === 'all' ? sk.marketplaceResultsTabAll : registeredProviders.find((rp) => rp.id === id)?.displayName ?? id;
    const count = aggregatedTabCounts[id] ?? 0;
    const status = id === 'all' ? null : aggregatedProviderStatus[id];
    return {
      id,
      label,
      title: status === 'error' ? `${label} · ${sk.marketplaceLoadFailed}` : undefined,
      suffix: status === 'loading' ? (
        <span className="inline-block size-1.5 animate-pulse rounded-full bg-fg-muted/60 motion-reduce:animate-none" aria-hidden />
      ) : status === 'error' ? (
        <span className="inline-block size-1.5 rounded-full bg-red-500" aria-hidden />
      ) : (
        <span className="tabular-nums opacity-70">{count}</span>
      ),
    };
  });

  return (
    <>
      <SkillsPageHeaderRegistration vm={vm} />
      <div className="flex min-h-0 min-w-0 flex-1 flex-col bg-surface-panel">
      <div className="flex w-full flex-col gap-6 px-3 py-6 sm:px-5 xl:px-6">
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
        {skillDiagnostics.length > 0 ? (
          <div
            className="rounded-xl border border-amber-200 bg-amber-50 px-3 py-2 text-sm text-amber-900 dark:border-amber-900/50 dark:bg-amber-950/30 dark:text-amber-200"
            role="status"
          >
            <div className="font-medium">Skill diagnostics: {skillDiagnostics.length}</div>
            <ul className="mt-1 space-y-1">
              {skillDiagnostics.slice(0, 3).map((diag, index) => (
                <li key={`${diag.path ?? diag.skillName ?? 'diagnostic'}-${index}`} className="truncate">
                  {diag.type}: {diag.message}
                </li>
              ))}
            </ul>
          </div>
        ) : null}
        {inSettingsShell ? (
          <div className="flex flex-col gap-3 border-b border-edge-subtle pb-4 dark:border-edge-subtle sm:flex-row sm:flex-wrap sm:items-center sm:justify-end">
            <SkillsPageHeaderEnd
              loading={vm.loading}
              onReloadClick={vm.onReloadClick}
              searchQuery={vm.searchQuery}
              setSearchQuery={vm.setSearchQuery}
              mainTab={vm.mainTab}
              sk={vm.sk}
              setPendingFile={vm.setPendingFile}
              setInstallOpen={vm.setInstallOpen}
            />
          </div>
        ) : null}

        <section className="flex flex-col gap-4">
          <div className="flex flex-col gap-3 border-b border-edge-subtle pb-3 sm:flex-row sm:items-center sm:justify-between dark:border-edge-subtle">
            <PageTabs
              items={mainTabItems}
              activeTab={mainTab}
              onChange={setMainTab}
              ariaLabel={sk.skillsNavAria}
              tabIdPrefix="skills-tab"
              panelIdPrefix="skills-panel"
              className="flex-wrap"
            />
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
                searchInputActive ? (
                  <PageTabs
                    items={resultTabItems}
                    activeTab={resultTab}
                    onChange={setResultTab}
                    ariaLabel={sk.marketplaceResultsTabsAria}
                    tabIdPrefix="skills-marketplace-results-tab"
                    panelIdPrefix="skills-marketplace-results-panel"
                    className="inline-flex h-9 shrink-0 rounded-lg border border-edge bg-surface-panel p-0.5 shadow-surface"
                    buttonClassName="rounded-md px-2.5 py-1.5 text-xs"
                    selectedClassName="bg-fg text-surface-panel dark:bg-fg dark:text-surface-base"
                    unselectedClassName="text-fg-muted hover:text-fg"
                  />
                ) : (
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
                )
              ) : null}
              {mainTab !== 'marketplace' && catalogDisabledCount > 0 ? (
                <button
                  type="button"
                  className={cn(
                    'inline-flex h-9 shrink-0 items-center rounded-lg border px-2.5 text-xs font-medium transition-colors',
                    interaction.focusRingPanel,
                    catalogStatusFilter === 'disabled'
                      ? 'border-fg bg-fg text-surface-panel dark:border-fg dark:bg-fg dark:text-surface-base'
                      : 'border-amber-300/80 bg-amber-50/90 text-amber-950 hover:border-amber-400 dark:border-amber-700/60 dark:bg-amber-950/40 dark:text-amber-100',
                  )}
                  aria-pressed={catalogStatusFilter === 'disabled'}
                  aria-label={sk.filterDisabledOnlyAria}
                  onClick={() =>
                    setCatalogStatusFilter((f) => (f === 'disabled' ? 'all' : 'disabled'))
                  }
                >
                  {catalogStatusFilter === 'disabled'
                    ? sk.filterAll
                    : interpolate(sk.filterDisabledOnly, { count: catalogDisabledCount })}
                </button>
              ) : mainTab === 'builtin' ? (
                <div className="h-9 min-w-[9rem] shrink-0" aria-hidden />
              ) : null}
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
    </>
  );
}

function SkillsPageHeaderRegistration({ vm }: { vm: SkillsPageVm }) {
  const {
    sk,
    hasToken,
    loading,
    onReloadClick,
    searchQuery,
    setSearchQuery,
    mainTab,
    setPendingFile,
    setInstallOpen,
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
      main: (
        <div className="min-w-0">
          <h1 className="truncate text-base font-semibold tracking-tight text-fg">{sk.title}</h1>
        </div>
      ),
      end: skillsHeaderEnd,
    });
    return () => clearPageHeader();
  }, [clearPageHeader, hasToken, inSettingsShell, setPageHeader, skillsHeaderEnd, sk.title]);

  return null;
}
