import { messages } from '@/i18n/messages';
import { useLocaleStore } from '@/stores/locale-store';

export function ChatHeader({
  sessionKey,
  sessionName,
  sessionRoutePending,
  routeTargetKey,
}: {
  sessionKey: string | null;
  sessionName: string | null;
  /** URL session differs from loaded session (switching or first load of `/chat/:key`) */
  sessionRoutePending?: boolean;
  /** Hash route target when `sessionRoutePending` — avoids showing stale title/model */
  routeTargetKey?: string;
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
    </header>
  );
}
