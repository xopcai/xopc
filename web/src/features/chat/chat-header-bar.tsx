import { Menu, Plus } from 'lucide-react';
import { memo, useEffect, useState } from 'react';
import { Link } from 'react-router-dom';

import { APP_CHROME_NO_DRAG_CLASS, APP_TOP_HEADER_BAR_CLASS } from '@/components/shell/app-chrome';
import { Button } from '@/components/ui/button';
import { ModelSelector } from '@/features/chat/model-selector';
import { messages } from '@/i18n/messages';
import { cn } from '@/lib/cn';
import { useAppShellStore } from '@/stores/app-shell-store';
import { useLocaleStore } from '@/stores/locale-store';
import { useSidebarStore } from '@/stores/sidebar-store';

/** Tailwind `lg` breakpoint — matches sidebar drawer vs in-flow rail. */
const MAX_LG = '(max-width: 1023px)';

type ChatHeaderBarProps = {
  chatHeadline: string;
  sessionModel: string;
  showModelSelector: boolean;
  onModelChange: (modelId: string) => void;
  modelDisabled: boolean;
};

/**
 * Subscribes to sidebar / mobile-nav stores in isolation so collapsing the rail
 * does not re-render the chat body (messages, composer, scroll state).
 */
export const ChatHeaderBar = memo(function ChatHeaderBar({
  chatHeadline,
  sessionModel,
  showModelSelector,
  onModelChange,
  modelDisabled,
}: ChatHeaderBarProps) {
  const language = useLocaleStore((s) => s.language);
  const m = messages(language);
  const sidebarCollapsed = useSidebarStore((s) => s.collapsed);
  const mobileNavOpen = useAppShellStore((s) => s.mobileNavOpen);
  const setMobileNavOpen = useAppShellStore((s) => s.setMobileNavOpen);

  const [isMobileLayout, setIsMobileLayout] = useState(() =>
    typeof globalThis.matchMedia === 'function' ? globalThis.matchMedia(MAX_LG).matches : false,
  );
  useEffect(() => {
    const mq = globalThis.matchMedia(MAX_LG);
    const onChange = () => setIsMobileLayout(mq.matches);
    onChange();
    mq.addEventListener('change', onChange);
    return () => mq.removeEventListener('change', onChange);
  }, []);

  /** Desktop: mirror collapsed rail. Mobile: drawer closed — same need as sidebar `navCollapsed`. */
  const showNewChatLink = isMobileLayout ? !mobileNavOpen : sidebarCollapsed;

  return (
    <div
      className={cn(
        'flex gap-3 px-3 sm:gap-4 sm:px-5 xl:px-6',
        APP_TOP_HEADER_BAR_CLASS,
        showNewChatLink &&
          (showModelSelector
            ? 'lg:grid lg:grid-cols-[auto_minmax(0,1fr)_auto] lg:items-center lg:gap-4'
            : 'lg:grid lg:grid-cols-[auto_minmax(0,1fr)] lg:items-center lg:gap-4'),
      )}
    >
      <div className="flex min-w-0 shrink-0 items-center gap-2.5">
        <Button
          type="button"
          variant="ghost"
          className={cn(
            'size-8 shrink-0 rounded-xl p-0 lg:hidden',
            APP_CHROME_NO_DRAG_CLASS,
            mobileNavOpen && 'hidden',
          )}
          aria-expanded={mobileNavOpen}
          aria-controls="app-sidebar"
          aria-label={m.openMenu}
          title={m.openMenu}
          onClick={() => setMobileNavOpen(true)}
        >
          <Menu className="size-4" strokeWidth={1.5} aria-hidden />
        </Button>
        {showNewChatLink ? (
          <Link
            to="/chat/new"
            className={cn(
              'inline-flex h-8 shrink-0 items-center gap-2 rounded-lg bg-surface-panel px-2.5 text-sm font-medium leading-none text-fg transition-colors hover:bg-surface-hover',
              'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent focus-visible:ring-offset-2 focus-visible:ring-offset-surface-panel',
              APP_CHROME_NO_DRAG_CLASS,
            )}
            title={m.sidebar.newTask}
          >
            <Plus className="size-4 shrink-0 text-accent-fg" strokeWidth={2} aria-hidden />
            <span className="max-w-[10rem] truncate sm:max-w-[14rem]">{m.sidebar.newTask}</span>
          </Link>
        ) : null}
      </div>
      <h1
        className={cn(
          'min-w-0 flex-1 truncate text-base font-semibold tracking-tight text-fg',
          showNewChatLink ? 'text-left lg:text-center' : 'text-left',
        )}
        title={chatHeadline}
      >
        {chatHeadline}
      </h1>
      {showModelSelector ? (
        <div
          className={cn(
            'min-w-0 w-fit max-w-[min(20rem,calc(100vw-10rem))] shrink-0',
            APP_CHROME_NO_DRAG_CLASS,
          )}
        >
          <ModelSelector
            value={sessionModel}
            disabled={modelDisabled}
            placeholder={m.chat.modelPlaceholder}
            searchPlaceholder={m.chat.modelSearchPlaceholder}
            noMatches={m.chat.modelNoMatches}
            compact
            showProviderInTrigger={false}
            contentSide="bottom"
            contentAlign="end"
            onChange={onModelChange}
          />
        </div>
      ) : null}
    </div>
  );
});
