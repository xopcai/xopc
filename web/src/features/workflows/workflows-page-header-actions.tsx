import { Plus, RefreshCw, Search } from 'lucide-react';

import { Button } from '@/components/ui/button';
import { cn } from '@/lib/cn';
import { interaction } from '@/lib/interaction';

import type { useWorkflowsPage } from './use-workflows-page';

export function WorkflowsPageHeaderActions({ vm }: { vm: ReturnType<typeof useWorkflowsPage> }) {
  const { labels, loading, searchQuery, setSearchQuery, refreshAll, setManageOpen } = vm;

  return (
    <div className="flex min-w-0 flex-wrap items-center gap-2">
      <div className="relative min-w-[12rem] flex-1 sm:max-w-xs">
        <Search className="pointer-events-none absolute left-2.5 top-1/2 size-4 -translate-y-1/2 text-fg-subtle" aria-hidden />
        <input
          value={searchQuery}
          onChange={(event) => setSearchQuery(event.target.value)}
          placeholder={labels.searchPlaceholder}
          className={cn(
            'h-9 w-full rounded-lg border border-edge bg-surface-panel py-2 pl-9 pr-3 text-sm text-fg shadow-surface',
            'placeholder:text-fg-subtle',
            interaction.focusRingPanel,
          )}
        />
      </div>
      <Button variant="secondary" onClick={() => setManageOpen(true)}>
        <Plus className="size-4" aria-hidden />
        {labels.addWorkflow}
      </Button>
      <Button variant="secondary" onClick={refreshAll} disabled={loading}>
        <RefreshCw className={cn('size-4', loading && 'animate-spin')} aria-hidden />
        {labels.refresh}
      </Button>
    </div>
  );
}
