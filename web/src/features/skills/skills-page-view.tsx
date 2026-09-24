import { useLayoutEffect, useMemo } from 'react';

import { PageTabs } from '@/components/ui/page-tabs';
import { Button } from '@/components/ui/button';
import { PopoverSelect } from '@/components/ui/popover-select';
import {
  CapabilityHeaderActions,
  CapabilityHeaderSearch,
  type CapabilityHeaderActionChange,
  type CapabilityHeaderContribution,
} from '@/features/capabilities/capability-header-actions';
import { FindSkillsButton } from '@/features/skills/find-skills-button';
import { SkillsHeaderOverflow } from '@/features/skills/skills-page-header-end';
import { SkillsPageCatalogContent } from '@/features/skills/skills-page-catalog-content';
import { SkillsPageConfirmDialog } from '@/features/skills/skills-page-confirm-dialog';
import { SkillsPageDetailDialog } from '@/features/skills/skills-page-detail-dialog';
import { SkillsPageInstallDialog } from '@/features/skills/skills-page-install-dialog';
import { SkillsPageMarketplaceContent } from '@/features/skills/skills-page-marketplace-content';
import type { CatalogStatusFilter, SourceFilter } from '@/features/skills/skills-page.constants';
import {
  displayableSkillDiagnostics,
  interpolate,
} from '@/features/skills/skills-page.utils';
import type { SkillsPageVm } from '@/features/skills/use-skills-page';
import { cn } from '@/lib/cn';
import { usePageHeaderStore } from '@/stores/page-header-store';

export function SkillsPageView({ vm, embedded = false, onHeaderActionChange }: { vm: SkillsPageVm; embedded?: boolean; onHeaderActionChange?: CapabilityHeaderActionChange }) {
  const {
    sk,
    hasToken,
    error,
    actionFeedback,
    skillDiagnostics,
    mainTab,
    setMainTab,
    sourceFilter,
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
    searchInputActive,
    resultTab,
    setResultTab,
    aggregatedTabCounts,
    aggregatedProviderStatus,
    recoveryReturnPath,
  } = vm;
  const visibleSkillDiagnostics = displayableSkillDiagnostics(skillDiagnostics);

  if (!hasToken) {
    return (
      <>
        <SkillsPageHeaderRegistration vm={vm} embedded={embedded} onHeaderActionChange={onHeaderActionChange} />
        <div className="w-full px-3 py-16 text-center text-sm text-fg-muted sm:px-5 xl:px-6">
          {sk.needToken}
        </div>
      </>
    );
  }

  const installedCount = builtinTabStats.total + userTabStats.total;
  const mainTabItems = [
    { id: 'installed' as const, label: sk.tabInstalled, count: installedCount },
    { id: 'marketplace' as const, label: sk.tabDiscover },
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
      <SkillsPageHeaderRegistration vm={vm} embedded={embedded} onHeaderActionChange={onHeaderActionChange} />
      <div className="flex min-h-0 min-w-0 flex-1 flex-col bg-surface-panel">
      <div className={cn(
        'mx-auto flex w-full max-w-7xl flex-col gap-6 px-4 sm:px-6 lg:px-8',
        embedded ? 'pb-7 pt-3 lg:pb-9 lg:pt-4' : 'py-7 lg:py-9',
      )}>
        {recoveryReturnPath ? (
          <div className="flex flex-col gap-3 rounded-xl border border-accent/25 bg-accent-soft px-4 py-3 sm:flex-row sm:items-center sm:justify-between">
            <div>
              <p className="text-sm font-semibold text-fg">{sk.recoveryTitle}</p>
              <p className="mt-1 text-xs leading-5 text-fg-muted">{sk.recoveryHint}</p>
            </div>
            <Button type="button" variant="secondary" className="min-h-11 shrink-0" onClick={vm.onRecoveryDone}>
              {sk.recoveryDone}
            </Button>
          </div>
        ) : null}
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
        {visibleSkillDiagnostics.length > 0 ? (
          <div
            className="rounded-xl border border-amber-200 bg-amber-50 px-3 py-2 text-sm text-amber-900 dark:border-amber-900/50 dark:bg-amber-950/30 dark:text-amber-200"
            role="status"
          >
            <div className="font-medium">
              {interpolate(sk.diagnosticsTitle, { count: visibleSkillDiagnostics.length })}
            </div>
            <ul className="mt-1 space-y-1">
              {visibleSkillDiagnostics.slice(0, 3).map((diag, index) => (
                <li key={`${diag.path ?? diag.skillName ?? 'diagnostic'}-${index}`} className="truncate">
                  {diag.type}: {diag.message}
                </li>
              ))}
            </ul>
          </div>
        ) : null}
        <section className="flex flex-col gap-5">
          <div className="flex flex-col gap-3 border-b border-edge-subtle pb-3 dark:border-edge-subtle sm:flex-row sm:items-center sm:justify-between">
            <PageTabs
              items={mainTabItems}
              activeTab={mainTab}
              onChange={setMainTab}
              ariaLabel={sk.skillsNavAria}
              tabIdPrefix="skills-tab"
              panelIdPrefix="skills-panel"
              className="flex-wrap"
            />
            <div className="flex min-w-0 flex-wrap gap-2 sm:justify-end">
              {mainTab === 'installed' ? (
                <>
                  <PopoverSelect
                    value={sourceFilter}
                    placeholder={sk.filterAll}
                    ariaLabel={sk.sourceFilterAria}
                    options={[
                      { value: 'all', label: sk.filterAll },
                      { value: 'builtin', label: sk.tabBuiltin },
                      { value: 'installed', label: sk.filterInstalled },
                      { value: 'workspace', label: sk.filterWorkspace },
                      { value: 'global', label: sk.filterGlobal },
                      { value: 'extra', label: sk.filterExtra },
                    ]}
                    allowEmpty={false}
                    triggerClassName="h-9 w-auto min-w-[9rem] bg-surface-panel text-xs shadow-surface"
                    align="end"
                    onChange={(value) => setSourceFilter(value as SourceFilter)}
                  />
                  <PopoverSelect
                    value={catalogStatusFilter}
                    placeholder={sk.filterAll}
                    ariaLabel={sk.statusFilterAria}
                    options={[
                      { value: 'all', label: sk.filterAll },
                      { value: 'enabled', label: sk.filterEnabled },
                      {
                        value: 'disabled',
                        label: interpolate(sk.filterDisabledOnly, { count: catalogDisabledCount }),
                      },
                    ]}
                    allowEmpty={false}
                    triggerClassName="h-9 w-auto min-w-[9rem] bg-surface-panel text-xs shadow-surface"
                    align="end"
                    onChange={(value) => setCatalogStatusFilter(value as CatalogStatusFilter)}
                  />
                </>
              ) : (
                <>
                  {!searchInputActive ? (
                    <PopoverSelect
                      value={marketBrowseProvider ?? ''}
                      placeholder={sk.marketplaceBrowseSwitchAria}
                      ariaLabel={sk.marketplaceBrowseSwitchAria}
                      options={registeredProviders.map((provider) => ({
                        value: provider.id,
                        label: provider.displayName,
                      }))}
                      allowEmpty={false}
                      triggerClassName="h-9 w-auto min-w-[9rem] bg-surface-panel text-xs shadow-surface"
                      align="end"
                      onChange={setMarketBrowseProvider}
                    />
                  ) : null}
                  <PopoverSelect
                    value={marketSort}
                    placeholder={sk.marketplaceSortLabel}
                    ariaLabel={sk.marketplaceSortLabel}
                    options={[
                      { value: 'downloads', label: sk.marketplaceSortDownloads },
                      { value: 'newest', label: sk.marketplaceSortNewest },
                    ]}
                    allowEmpty={false}
                    triggerClassName="h-9 w-auto min-w-[9rem] bg-surface-panel text-xs shadow-surface"
                    align="end"
                    onChange={(value) => setMarketSort(value as 'downloads' | 'newest')}
                  />
                </>
              )}
            </div>
          </div>

          {mainTab === 'marketplace' && searchInputActive ? (
            <PageTabs
              items={resultTabItems}
              activeTab={resultTab}
              onChange={setResultTab}
              ariaLabel={sk.marketplaceResultsTabsAria}
              tabIdPrefix="skills-marketplace-results-tab"
              panelIdPrefix="skills-marketplace-results-panel"
              className="min-h-9 gap-1 overflow-x-auto rounded-lg border border-edge bg-surface-panel p-0.5 shadow-surface"
              buttonClassName="rounded-md px-2.5 py-1.5 text-xs"
              selectedClassName="bg-fg text-surface-panel dark:bg-fg dark:text-surface-base"
              unselectedClassName="text-fg-muted hover:text-fg"
            />
          ) : null}

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

function SkillsPageHeaderRegistration({
  vm,
  embedded = false,
  onHeaderActionChange,
}: {
  vm: SkillsPageVm;
  embedded?: boolean;
  onHeaderActionChange?: CapabilityHeaderActionChange;
}) {
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

  const headerContribution = useMemo<CapabilityHeaderContribution | null>(
    () => hasToken ? ({
      searchLabel: mainTab === 'marketplace' ? sk.marketplaceSearchPackages : sk.searchPlaceholder,
      search: (
        <CapabilityHeaderSearch
          value={searchQuery}
          onChange={setSearchQuery}
          placeholder={mainTab === 'marketplace' ? sk.marketplaceSearchPackages : sk.searchPlaceholder}
        />
      ),
      primary: (
        <FindSkillsButton
          sk={sk}
          findingSkills={vm.findingSkills}
          onFindSkills={vm.onFindSkills}
          compactOnMobile
        />
      ),
      overflow: (
        <SkillsHeaderOverflow
        loading={loading}
        onReloadClick={onReloadClick}
        sk={sk}
        setPendingFile={setPendingFile}
        setInstallOpen={setInstallOpen}
        />
      ),
    }) : null,
    [hasToken, loading, mainTab, onReloadClick, searchQuery, setInstallOpen, setPendingFile, setSearchQuery, sk, vm.findingSkills, vm.onFindSkills],
  );

  useLayoutEffect(() => {
    if (embedded) {
      onHeaderActionChange?.(headerContribution);
      return () => onHeaderActionChange?.(null);
    }
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
      end: <CapabilityHeaderActions contribution={headerContribution} />,
    });
    return () => clearPageHeader();
  }, [clearPageHeader, embedded, hasToken, headerContribution, inSettingsShell, onHeaderActionChange, setPageHeader, sk.title]);

  return null;
}
