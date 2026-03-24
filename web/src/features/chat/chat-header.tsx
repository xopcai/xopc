import { Plus } from 'lucide-react';

import { ModelSelector } from '@/features/chat/model-selector';
import { messages } from '@/i18n/messages';
import { useLocaleStore } from '@/stores/locale-store';

export function ChatHeader({
  sessionKey,
  sessionName,
  sessionModel,
  streaming,
  onModelChange,
  onNewSession,
}: {
  sessionKey: string | null;
  sessionName: string | null;
  sessionModel: string;
  streaming: boolean;
  onModelChange: (modelId: string) => void;
  onNewSession: () => void;
}) {
  const language = useLocaleStore((s) => s.language);
  const m = messages(language);
  const headline = sessionKey ? (sessionName?.trim() || sessionKey) : m.nav.chat;

  return (
    <header className="flex flex-wrap items-center gap-3 border-b border-edge-subtle bg-surface-panel px-4 py-3.5 sm:px-8 dark:border-edge">
      <div className="min-w-0 flex-1">
        <h1
          className="truncate text-base font-semibold tracking-tight text-fg"
          title={sessionKey ?? undefined}
        >
          {headline}
        </h1>
      </div>
      {sessionKey ? (
        <div className="max-w-[min(22rem,calc(100vw-8rem))] shrink-0" title={m.chat.currentModel}>
          <ModelSelector
            value={sessionModel}
            disabled={streaming}
            placeholder={m.chat.modelPlaceholder}
            searchPlaceholder={m.chat.modelSearchPlaceholder}
            noMatches={m.chat.modelNoMatches}
            compact
            onChange={onModelChange}
          />
        </div>
      ) : null}
      <button
        type="button"
        className="inline-flex shrink-0 items-center gap-1.5 rounded-xl border border-edge bg-surface-panel px-3 py-2 text-sm font-medium text-fg-muted transition-colors duration-150 hover:bg-surface-hover hover:text-fg active:scale-95 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent focus-visible:ring-offset-2 focus-visible:ring-offset-surface-panel dark:border-edge"
        onClick={() => onNewSession()}
      >
        <Plus className="h-4 w-4 stroke-[1.75]" aria-hidden />
        <span>{m.chat.newSession}</span>
      </button>
    </header>
  );
}
