import { useLogsPage } from '@/features/logs/hooks/use-logs-page';
import { LogsDetailDrawer } from '@/features/logs/logs-detail-drawer';
import { LogsFilesDialog } from '@/features/logs/logs-files-dialog';
import { LogsFiltersDialog } from '@/features/logs/logs-filters-dialog';
import { LogsFiltersSection } from '@/features/logs/logs-filters-section';
import { LogsListSection } from '@/features/logs/logs-list-section';
import { LogsNoToken } from '@/features/logs/logs-no-token';
import { LogsPageHeader } from '@/features/logs/logs-page-header';
import { LogsStatsPopover } from '@/features/logs/logs-stats-popover';
import { useLocaleStore } from '@/stores/locale-store';

export function LogsPage() {
  const language = useLocaleStore((s) => s.language);
  const {
    L,
    hasToken,
    logs,
    loading,
    error,
    hasMore,
    searchInput,
    setSearchInput,
    selectedLevels,
    moduleFilter,
    setModuleFilter,
    dateFrom,
    setDateFrom,
    dateTo,
    setDateTo,
    modules,
    files,
    stats,
    selectedLog,
    setSelectedLog,
    filesOpen,
    setFilesOpen,
    filtersOpen,
    setFiltersOpen,
    logDir,
    autoRefresh,
    setAutoRefresh,
    copiedDetail,
    setCopiedDetail,
    hasActiveFilters,
    activeFilterCount,
    clearFilters,
    toggleDialogLevel,
    handleLoadMore,
    refreshAll,
    levelSegment,
    handleLevelSegment,
  } = useLogsPage(language);

  if (!hasToken) {
    return <LogsNoToken L={L} />;
  }

  return (
    <div className="mx-auto flex w-full max-w-app-main flex-col gap-6 px-4 py-6">
      <LogsPageHeader
        L={L}
        autoRefresh={autoRefresh}
        onAutoRefreshChange={setAutoRefresh}
        fileCount={files.length}
        onOpenFiles={() => setFilesOpen(true)}
        loading={loading}
        onRefreshAll={refreshAll}
      />

      {error ? (
        <div
          className="rounded-xl border border-edge bg-surface-base px-3 py-2 text-sm text-fg dark:border-edge"
          role="alert"
        >
          {error}
        </div>
      ) : null}

      {stats ? <LogsStatsPopover L={L} stats={stats} /> : null}

      <LogsFiltersSection
        L={L}
        levelSegment={levelSegment}
        onLevelSegment={handleLevelSegment}
        searchInput={searchInput}
        onSearchInputChange={setSearchInput}
        moduleFilter={moduleFilter}
        onModuleFilterChange={setModuleFilter}
        modules={modules}
        onOpenFilters={() => setFiltersOpen(true)}
        activeFilterCount={activeFilterCount}
        hasActiveFilters={hasActiveFilters}
        onClearFilters={clearFilters}
        autoRefresh={autoRefresh}
      />

      <LogsListSection
        L={L}
        logs={logs}
        loading={loading}
        hasMore={hasMore}
        onSelectLog={setSelectedLog}
        onLoadMore={handleLoadMore}
        onRefreshAll={refreshAll}
      />

      <LogsFiltersDialog
        L={L}
        open={filtersOpen}
        onOpenChange={setFiltersOpen}
        dateFrom={dateFrom}
        onDateFromChange={setDateFrom}
        dateTo={dateTo}
        onDateToChange={setDateTo}
        selectedLevels={selectedLevels}
        onToggleLevel={toggleDialogLevel}
      />

      <LogsDetailDrawer
        L={L}
        log={selectedLog}
        onClose={() => setSelectedLog(null)}
        copiedDetail={copiedDetail}
        onCopiedMessage={() => setCopiedDetail('message')}
        onCopiedJson={() => setCopiedDetail('json')}
      />

      <LogsFilesDialog L={L} open={filesOpen} onOpenChange={setFilesOpen} files={files} logDir={logDir} />
    </div>
  );
}
