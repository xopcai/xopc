import { Moon, Plus, Search } from 'lucide-react';

import { Button } from '@/components/ui/button';
import type { StoredLanguage } from '@/lib/storage';
import type { AgentsSettingsMessages } from '@/i18n/messages';

export type AgentsSettingsToolbarProps = {
  language: StoredLanguage;
  a: Pick<AgentsSettingsMessages, 'addAgent' | 'addAgentAria' | 'listSearchPlaceholder'>;
  busy: boolean;
  sleeping: boolean;
  listSearchQuery: string;
  onListSearchQueryChange: (value: string) => void;
  onSleep: () => void;
  onAddAgent: () => void;
};

export function AgentsSettingsToolbar({
  language,
  a,
  busy,
  sleeping,
  listSearchQuery,
  onListSearchQueryChange,
  onSleep,
  onAddAgent,
}: AgentsSettingsToolbarProps) {
  return (
    <div className="flex min-w-0 flex-1 flex-wrap items-center justify-end gap-2">
      <Button
        type="button"
        variant="secondary"
        className="shrink-0 gap-2"
        disabled={busy || sleeping}
        onClick={() => void onSleep()}
        aria-label={language === 'zh' ? '让智能体进入睡眠流程' : 'Trigger agent sleep sequence'}
        title={language === 'zh' ? '由浅入深：Light → Deep → REM' : 'Light → Deep → REM'}
      >
        <Moon className="size-4 shrink-0" strokeWidth={1.75} aria-hidden />
        {language === 'zh' ? (sleeping ? '睡眠中…' : '睡眠') : sleeping ? 'Sleeping…' : 'Sleep'}
      </Button>
      <label className="relative flex min-h-9 min-w-0 max-w-sm cursor-text items-center rounded-pill border border-edge bg-surface-base py-1.5 pl-9 pr-3 shadow-surface dark:bg-surface-hover/40 sm:max-w-md">
        <Search
          className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-fg-disabled"
          strokeWidth={1.75}
          aria-hidden
        />
        <input
          type="search"
          role="searchbox"
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
