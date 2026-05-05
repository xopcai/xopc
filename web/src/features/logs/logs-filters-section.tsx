import { ListFilter, Search, X } from 'lucide-react';

import { SlidingSegmented } from '@/components/ui/sliding-segmented';
import { Button } from '@/components/ui/button';
import { bareInputFocusClass, selectControlBaseClass } from '@/lib/form-field-width';
import { cn } from '@/lib/cn';
import type { LevelSegmentValue } from '@/features/logs/logs-page-lib';
import type { LogsMessages } from '@/i18n/messages';

type Props = {
  L: LogsMessages;
  levelSegment: LevelSegmentValue;
  onLevelSegment: (v: LevelSegmentValue) => void;
  searchInput: string;
  onSearchInputChange: (v: string) => void;
  moduleFilter: string;
  onModuleFilterChange: (v: string) => void;
  modules: string[];
  onOpenFilters: () => void;
  activeFilterCount: number;
  hasActiveFilters: boolean;
  onClearFilters: () => void;
  autoRefresh: boolean;
};

export function LogsFiltersSection({
  L,
  levelSegment,
  onLevelSegment,
  searchInput,
  onSearchInputChange,
  moduleFilter,
  onModuleFilterChange,
  modules,
  onOpenFilters,
  activeFilterCount,
  hasActiveFilters,
  onClearFilters,
  autoRefresh,
}: Props) {
  return (
    <section className="flex flex-col gap-3" aria-label={L.filters}>
      <div className="overflow-x-auto pb-1 [-ms-overflow-style:none] [scrollbar-width:none] [&::-webkit-scrollbar]:hidden">
        <div className="min-w-[min(100%,36rem)]">
          <SlidingSegmented<LevelSegmentValue>
            aria-label={L.levelPresetAria}
            value={levelSegment}
            onChange={onLevelSegment}
            options={[
              { value: 'all', label: L.presetAll },
              { value: 'errors', label: L.presetErrors },
              { value: 'warnPlus', label: L.presetWarnPlus },
              { value: 'infoPlus', label: L.presetInfoPlus },
              { value: 'verbose', label: L.presetVerbose },
              { value: 'other', label: L.presetOther },
            ]}
            buttonClassName="h-8 px-1.5 text-[11px] sm:px-2 sm:text-xs"
          />
        </div>
      </div>

      <div className="flex flex-col gap-2 sm:flex-row sm:flex-wrap sm:items-center">
        <label className="relative min-w-0 flex-1 sm:min-w-[12rem]">
          <span className="sr-only">{L.searchPlaceholder}</span>
          <Search
            className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-fg-subtle"
            strokeWidth={1.75}
            aria-hidden
          />
          <input
            type="search"
            value={searchInput}
            onChange={(e) => onSearchInputChange(e.target.value)}
            placeholder={L.searchPlaceholder}
            autoComplete="off"
            spellCheck={false}
            className={cn(
              'h-10 w-full rounded-md border border-edge bg-surface-panel py-0 pl-10 pr-3 text-sm leading-5 text-fg placeholder:text-fg-subtle dark:border-edge',
              bareInputFocusClass,
            )}
          />
        </label>

        <select
          id="log-module"
          value={moduleFilter}
          onChange={(e) => onModuleFilterChange(e.target.value)}
          aria-label={L.module}
          title={L.module}
          className={cn(
            selectControlBaseClass,
            'h-10 w-full min-w-0 rounded-md py-0 sm:w-[min(100%,14rem)] sm:shrink-0',
          )}
        >
          <option value="">{L.allModules}</option>
          {modules.map((mod) => (
            <option key={mod} value={mod}>
              {mod}
            </option>
          ))}
        </select>

        <div className="flex min-w-0 shrink-0 items-center gap-2">
          <Button
            type="button"
            variant="secondary"
            className="h-10 min-h-[44px] gap-2 rounded-md sm:min-h-10"
            onClick={onOpenFilters}
          >
            <ListFilter className="size-4" strokeWidth={1.75} />
            {L.filtersMore}
            {activeFilterCount > 0 ? (
              <span className="rounded-md bg-surface-hover px-1.5 text-xs tabular-nums text-fg-muted">
                {activeFilterCount}
              </span>
            ) : null}
          </Button>
          {hasActiveFilters ? (
            <Button type="button" variant="ghost" className="h-10 min-h-[44px] gap-1 sm:min-h-10" onClick={onClearFilters}>
              <X className="size-4" strokeWidth={1.75} />
              {L.clear}
            </Button>
          ) : null}
        </div>
      </div>

      {autoRefresh ? <p className="text-xs leading-5 text-fg-subtle">{L.liveHint}</p> : null}
    </section>
  );
}