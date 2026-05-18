import { Plus, RefreshCw, Search } from 'lucide-react';
import { memo } from 'react';

import { Button } from '@/components/ui/button';
import { cn } from '@/lib/cn';
import type { MainTab } from '@/features/skills/skills-page.constants';
import type { SkillsCopy } from '@/features/skills/skill-catalog-structured-preview';

export const SkillsPageHeaderEnd = memo(function SkillsPageHeaderEnd({
  loading,
  onReloadClick,
  searchQuery,
  setSearchQuery,
  mainTab,
  sk,
  setPendingFile,
  setInstallOpen,
}: {
  loading: boolean;
  onReloadClick: () => void;
  searchQuery: string;
  setSearchQuery: (v: string) => void;
  mainTab: MainTab;
  sk: SkillsCopy;
  setPendingFile: (f: File | null) => void;
  setInstallOpen: (v: boolean) => void;
}) {
  return (
    <div className="flex min-w-0 flex-1 flex-wrap items-center justify-end gap-2">
      <Button
        type="button"
        variant="ghost"
        className="size-9 shrink-0 p-0"
        disabled={loading}
        title={sk.reloadRuntime}
        aria-label={sk.reloadDiskAria}
        onClick={() => void onReloadClick()}
      >
        <RefreshCw className={cn('size-4', loading && 'animate-spin')} strokeWidth={1.75} />
      </Button>
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
          onChange={(e) => setSearchQuery(e.target.value)}
          placeholder={mainTab === 'marketplace' ? sk.marketplaceSearchPackages : sk.searchPlaceholder}
          autoComplete="off"
          spellCheck={false}
          className="min-w-0 flex-1 appearance-none border-0 bg-transparent py-0.5 text-sm leading-normal text-fg caret-current placeholder:text-fg-disabled focus:border-0 focus:shadow-none focus:outline-none focus:ring-0 focus-visible:outline-none"
        />
      </label>
      <Button
        type="button"
        variant="primary"
        className="shrink-0 gap-2"
        onClick={() => {
          setPendingFile(null);
          setInstallOpen(true);
        }}
      >
        <Plus className="size-4" strokeWidth={1.75} aria-hidden />
        {sk.installCta}
      </Button>
    </div>
  );
});
