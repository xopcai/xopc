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
    <div className="flex flex-wrap items-center gap-3 border-b border-edge bg-surface-panel px-4 py-3 dark:border-edge">
      <div className="min-w-0 flex-1">
        <span className="truncate text-sm font-semibold text-fg" title={sessionKey ?? undefined}>
          {headline}
        </span>
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
        className="inline-flex shrink-0 items-center gap-1.5 rounded-xl border border-edge bg-surface-base px-3 py-2 text-sm font-medium text-fg hover:bg-surface-hover focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent dark:border-edge"
        onClick={() => onNewSession()}
      >
        <Plus className="h-4 w-4" aria-hidden />
        <span>{m.chat.newSession}</span>
      </button>
    </div>
  );
}
