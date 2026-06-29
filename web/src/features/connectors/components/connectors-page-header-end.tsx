import { Plus, Search } from 'lucide-react';
import { memo } from 'react';

import { Button } from '@/components/ui/button';
import { RefreshButton } from '@/components/ui/refresh-button';

export const ConnectorsPageHeaderEnd = memo(function ConnectorsPageHeaderEnd({
  loading,
  searchQuery,
  setSearchQuery,
  onReloadClick,
  onAddCustomServer,
  searchPlaceholder,
  addLabel,
  reloadLabel,
}: {
  loading: boolean;
  searchQuery: string;
  setSearchQuery: (value: string) => void;
  onReloadClick: () => void;
  onAddCustomServer: () => void;
  searchPlaceholder: string;
  addLabel: string;
  reloadLabel: string;
}) {
  return (
    <div className="flex min-w-0 flex-1 flex-wrap items-center justify-end gap-2">
      <RefreshButton
        className="size-9 shrink-0 p-0"
        loading={loading}
        label={reloadLabel}
        title={reloadLabel}
        onClick={onReloadClick}
      />
      <label className="relative flex min-h-9 min-w-0 max-w-sm cursor-text items-center rounded-pill border border-edge bg-surface-base py-1.5 pl-9 pr-3 shadow-surface dark:bg-surface-hover/40 sm:max-w-md">
        <Search
          className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-fg-disabled"
          strokeWidth={1.75}
          aria-hidden
        />
        <input
          type="search"
          enterKeyHint="search"
          value={searchQuery}
          onChange={(event) => setSearchQuery(event.currentTarget.value)}
          placeholder={searchPlaceholder}
          autoComplete="off"
          spellCheck={false}
          className="min-w-0 flex-1 appearance-none border-0 bg-transparent py-0.5 text-sm leading-normal text-fg caret-current placeholder:text-fg-disabled focus:border-0 focus:shadow-none focus:outline-none focus:ring-0 focus-visible:outline-none"
        />
      </label>
      <Button type="button" variant="primary" className="shrink-0 gap-2" onClick={onAddCustomServer}>
        <Plus className="size-4" strokeWidth={1.75} aria-hidden />
        {addLabel}
      </Button>
    </div>
  );
});

