import { Plus, Search } from 'lucide-react';

import { Button } from '@/components/ui/button';
import type { AgentsSettingsMessages } from '@/i18n/messages';

export type AgentsSettingsToolbarProps = {
  a: Pick<AgentsSettingsMessages, 'addAgent' | 'addAgentAria' | 'listSearchPlaceholder'>;
  busy: boolean;
  listSearchQuery: string;
  onListSearchQueryChange: (value: string) => void;
  onAddAgent: () => void;
};

export function AgentsSettingsToolbar({
  a,
  busy,
  listSearchQuery,
  onListSearchQueryChange,
  onAddAgent,
}: AgentsSettingsToolbarProps) {
  return (
    <div className="flex min-w-0 flex-1 flex-wrap items-center justify-end gap-2">
      <label className="relative flex min-h-9 min-w-0 max-w-sm cursor-text items-center rounded-pill border border-edge bg-surface-base py-1.5 pl-9 pr-3 shadow-surface dark:bg-surface-hover/40 sm:max-w-md">
        <Search
          className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-fg-disabled"
          strokeWidth={1.75}
          aria-hidden
        />
        <input
          type="search"
          enterKeyHint="search"
          value={listSearchQuery}
          onChange={(e) => onListSearchQueryChange(e.target.value)}
          placeholder={a.listSearchPlaceholder}
          autoComplete="off"
          spellCheck={false}
          aria-label={a.listSearchPlaceholder}
          className="min-w-0 flex-1 appearance-none border-0 bg-transparent py-0.5 text-sm leading-normal text-fg caret-current placeholder:text-fg-disabled focus:border-0 focus:shadow-none focus:outline-none focus:ring-0 focus-visible:outline-none"
        />
      </label>
      <Button
        type="button"
        variant="primary"
        className="shrink-0 gap-2"
        aria-label={a.addAgentAria}
        disabled={busy}
        onClick={() => onAddAgent()}
      >
        <Plus className="size-4" strokeWidth={1.75} aria-hidden />
        {a.addAgent}
      </Button>
    </div>
  );
}
