import { Plus } from 'lucide-react';

import { messages } from '@/i18n/messages';
import { cn } from '@/lib/cn';
import { useLocaleStore } from '@/stores/locale-store';

export function ChatHeader({
  sessionKey,
  sessionName,
  loading,
  sessionRoutePending,
  routeTargetKey,
  onNewSession,
}: {
  sessionKey: string | null;
  sessionName: string | null;
  /** Blocking init (e.g. `/chat` pick-session) — avoid competing navigations */
  loading?: boolean;
  /** URL session differs from loaded session (switching or first load of `/chat/:key`) */
  sessionRoutePending?: boolean;
  /** Hash route target when `sessionRoutePending` — avoids showing stale title/model */
  routeTargetKey?: string;
  onNewSession: () => void;
}) {
  const language = useLocaleStore((s) => s.language);
  const m = messages(language);
  const titleKey = sessionRoutePending && routeTargetKey ? routeTargetKey : sessionKey;
  const headline =
    !titleKey
      ? m.nav.chat
      : sessionRoutePending && routeTargetKey
        ? routeTargetKey
        : sessionName?.trim() || titleKey;

  return (
    <header className="flex flex-wrap items-center gap-3 border-b border-edge-subtle bg-surface-panel px-4 py-3 sm:px-8 dark:border-edge">
      <div className="min-w-0 flex-1 basis-[min(0,100%)]">
        <h1
          className="truncate text-base font-semibold tracking-tight text-fg"
          title={titleKey ?? undefined}
        >
          {headline}
        </h1>
      </div>
      <button
        type="button"
        disabled={loading || sessionRoutePending}
        className={cn(
          'inline-flex shrink-0 items-center gap-1.5 rounded-xl border border-edge bg-surface-panel px-2.5 py-2 text-sm font-medium text-fg-muted transition-colors duration-150 hover:bg-surface-hover hover:text-fg focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent focus-visible:ring-offset-2 focus-visible:ring-offset-surface-panel disabled:pointer-events-none disabled:opacity-50 lg:px-3 dark:border-edge',
        )}
        onClick={() => onNewSession()}
      >
        <Plus className="h-4 w-4 shrink-0 stroke-[1.75]" aria-hidden />
        <span className="max-lg:sr-only">{m.chat.newSession}</span>
      </button>
    </header>
  );
}
