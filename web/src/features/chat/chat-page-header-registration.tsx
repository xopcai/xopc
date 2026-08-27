import { FolderOpen, Plus, SquareTerminal } from 'lucide-react';
import { memo, useEffect, useLayoutEffect } from 'react';
import { Link, useParams } from 'react-router-dom';

import { APP_CHROME_NO_DRAG_CLASS } from '@/components/shell/app-chrome';
import { getShellChromeRuntime, resolveShellChromeLayout } from '@/components/shell/chrome-layout';
import { ChatAgentSelector } from '@/features/chat/agent-selection/chat-agent-selector';
import type { ChatAgentOption } from '@/features/chat/agent-selection/chat-agents-api';
import { matchesTerminalShortcut, terminalShortcutLabel } from '@/features/chat/terminal/terminal-shortcut';
import { messages } from '@/i18n/messages';
import { cn } from '@/lib/cn';
import { useAppShellStore } from '@/stores/app-shell-store';
import { usePageHeaderStore } from '@/stores/page-header-store';
import { useLocaleStore } from '@/stores/locale-store';
import { useSidebarStore } from '@/stores/sidebar-store';
import { useWorkspacePanelStore } from '@/stores/workspace-panel-store';
import { useMediaQuery } from '@/lib/use-media-query';
import { useSideChatStore } from '@/stores/side-chat-store';
import { useTerminalPanelStore } from '@/stores/terminal-panel-store';

const MAX_MD = '(max-width: 767px)';

type ChatPageHeaderRegistrationProps = {
  chatHeadline: string;
  chatAgents: ChatAgentOption[];
  showChatAgentSelector: boolean;
  chatAgentId: string;
  onChatAgentChange: (agentId: string) => void;
  chatAgentDisabled: boolean;
};

/**
 * Registers chat title / agent / new-task link into `page-header-store` for {@link PrimaryAppHeader}.
 */
export const ChatPageHeaderRegistration = memo(function ChatPageHeaderRegistration({
  chatHeadline,
  chatAgents,
  showChatAgentSelector,
  chatAgentId,
  onChatAgentChange,
  chatAgentDisabled,
}: ChatPageHeaderRegistrationProps) {
  const language = useLocaleStore((s) => s.language);
  const { sessionKey } = useParams();
  const parentSessionKey = sessionKey && sessionKey !== 'new' ? decodeURIComponent(sessionKey) : null;
  const m = messages(language);
  const sidebarCollapsed = useSidebarStore((s) => s.collapsed);
  const workspacePanelOpen = useWorkspacePanelStore((s) => s.open);
  const toggleWorkspacePanel = useWorkspacePanelStore((s) => s.toggleOpen);
  const setSideChatOpen = useSideChatStore((s) => s.setOpen);
  const terminalPanelOpen = useTerminalPanelStore((s) => parentSessionKey ? Boolean(s.openBySessionKey[parentSessionKey]) : false);
  const toggleTerminalPanel = useTerminalPanelStore((s) => s.toggle);
  const mobileNavOpen = useAppShellStore((s) => s.mobileNavOpen);
  const setPageHeader = usePageHeaderStore((s) => s.setPageHeader);
  const clearPageHeader = usePageHeaderStore((s) => s.clearPageHeader);
  const terminalPlatform = window.electronAPI?.platform;
  const terminalShortcut = terminalShortcutLabel(terminalPlatform);

  const isMobileLayout = useMediaQuery(MAX_MD);
  const chromeLayout = resolveShellChromeLayout({
    runtime: getShellChromeRuntime(),
    sidebarCollapsed,
    mobileNavOpen,
  });

  const showNewChatLink = isMobileLayout
    ? !mobileNavOpen
    : chromeLayout.collapsedNewChatVisible;

  // Header details change as a session is created. Clear only when this page
  // actually leaves; clearing during an in-place replacement visibly remounts
  // the shell chrome.
  useLayoutEffect(() => () => clearPageHeader(), [clearPageHeader]);

  useEffect(() => {
    if (!parentSessionKey || !window.electronAPI?.terminal) return;
    const onKeyDown = (event: KeyboardEvent) => {
      if (!matchesTerminalShortcut(event, terminalPlatform)) return;
      event.preventDefault();
      toggleTerminalPanel(parentSessionKey);
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [parentSessionKey, terminalPlatform, toggleTerminalPanel]);

  useLayoutEffect(() => {
    setPageHeader({
      className: 'bg-surface-panel',
      startExtra: showNewChatLink ? (
        <Link
          to="/chat/new"
          state={{ forceNewChat: true }}
          className={cn(
            'inline-flex size-8 shrink-0 items-center justify-center rounded-lg bg-surface-panel text-sm font-medium leading-none text-fg transition-colors hover:bg-surface-hover',
            'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent focus-visible:ring-offset-2 focus-visible:ring-offset-surface-panel',
            APP_CHROME_NO_DRAG_CLASS,
          )}
          title={m.sidebar.newTask}
        >
          <Plus className="size-4 shrink-0 text-accent-fg" strokeWidth={2} aria-hidden />
        </Link>
      ) : null,
      main: (
        <div className="w-full min-w-0 max-w-(--max-width-chat) px-3 sm:px-5 xl:px-6">
          <h1
            className={cn(
              'min-w-0 truncate text-base font-semibold tracking-tight text-fg',
              showNewChatLink ? 'text-left md:text-center' : 'text-left',
            )}
            title={chatHeadline}
          >
            {chatHeadline}
          </h1>
        </div>
      ),
      end: (
        <div
          className={cn(
            'flex min-w-0 max-w-[min(32rem,calc(100vw-8rem))] shrink-0 items-center justify-end gap-2',
            APP_CHROME_NO_DRAG_CLASS,
          )}
        >
          {showChatAgentSelector ? (
            <div className="min-w-0 w-fit shrink-0">
              <ChatAgentSelector
                items={chatAgents}
                value={chatAgentId}
                disabled={chatAgentDisabled}
                placeholder={m.chat.agentPlaceholder}
                searchPlaceholder={m.chat.agentSearchPlaceholder}
                noMatches={m.chat.agentNoMatches}
                compact
                contentSide="bottom"
                contentAlign="end"
                onChange={onChatAgentChange}
              />
            </div>
          ) : null}
          {parentSessionKey && window.electronAPI?.terminal ? (
            <button
              type="button"
              className={cn(
                'rounded-md p-2 text-fg-muted transition-colors hover:bg-surface-hover hover:text-fg',
                terminalPanelOpen && 'bg-surface-hover text-fg',
              )}
              title={`${m.chat.terminal.open} (${terminalShortcut})`}
              aria-label={m.chat.terminal.open}
              aria-pressed={terminalPanelOpen}
              onClick={() => toggleTerminalPanel(parentSessionKey)}
            >
              <SquareTerminal className="size-4" />
            </button>
          ) : null}
          <button
            type="button"
            className={cn(
              'rounded-md p-2 text-fg-muted transition-colors hover:bg-surface-hover hover:text-fg',
              workspacePanelOpen && 'bg-surface-hover text-fg',
            )}
            title={m.workspace.openFiles}
            aria-label={m.workspace.openFiles}
            aria-pressed={workspacePanelOpen}
            onClick={() => {
              if (!workspacePanelOpen && parentSessionKey) setSideChatOpen(parentSessionKey, false);
              toggleWorkspacePanel();
            }}
          >
            <FolderOpen className="size-4" />
          </button>
        </div>
      ),
    });
  }, [
    chatHeadline,
    chatAgents,
    showChatAgentSelector,
    chatAgentId,
    onChatAgentChange,
    chatAgentDisabled,
    showNewChatLink,
    m.chat.agentPlaceholder,
    m.chat.agentSearchPlaceholder,
    m.chat.agentNoMatches,
    m.chat.terminal.open,
    terminalShortcut,
    m.sidebar.newTask,
    m.workspace.openFiles,
    workspacePanelOpen,
    terminalPanelOpen,
    parentSessionKey,
    toggleTerminalPanel,
    toggleWorkspacePanel,
    setSideChatOpen,
    setPageHeader,
  ]);

  return null;
});
