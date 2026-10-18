import * as DropdownMenu from '@radix-ui/react-dropdown-menu';
import { MoreHorizontal, Plus, Search, Share2 } from 'lucide-react';
import { memo, useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react';
import { Link, useParams } from 'react-router-dom';

import { APP_CHROME_NO_DRAG_CLASS } from '@/components/shell/app-chrome';
import { getShellChromeRuntime, resolveShellChromeLayout } from '@/components/shell/chrome-layout';
import { ChatAgentSelector } from '@/features/chat/agent-selection/chat-agent-selector';
import type { ChatAgentOption } from '@/features/chat/agent-selection/chat-agents-api';
import { SessionContextPanel, type SessionContextPanelProps } from '@/features/chat/context/session-context-panel';
import { useSessionContext } from '@/features/chat/context/use-session-context';
import { ChatWorkspaceControl } from '@/features/chat/workspace/chat-workspace-control';
import { matchesTerminalShortcut } from '@/features/chat/terminal/terminal-shortcut';
import {
  matchesSideChatShortcut,
} from '@/features/side-chat/side-chat-shortcut';
import { messages } from '@/i18n/messages';
import { cn } from '@/lib/cn';
import { useAppShellStore } from '@/stores/app-shell-store';
import { usePageHeaderStore } from '@/stores/page-header-store';
import { useLocaleStore } from '@/stores/locale-store';
import { useSidebarStore } from '@/stores/sidebar-store';
import { useRightWorkspaceStore } from '@/stores/right-workspace-store';
import { useSideChatStore } from '@/stores/side-chat-store';
import { useMediaQuery } from '@/lib/use-media-query';
import { useTerminalPanelStore } from '@/stores/terminal-panel-store';
import { newChatHrefForProject } from '@/features/chat/session/composer-handoff-params';
import { SessionShareButton } from '@/features/shares/session-share-button';

const MAX_MD = '(max-width: 767px)';

type ChatPageHeaderRegistrationProps = {
  chatHeadline: string;
  chatAgents: ChatAgentOption[];
  showChatAgentSelector: boolean;
  chatAgentId: string;
  onChatAgentChange: (agentId: string) => void;
  chatAgentDisabled: boolean;
  conversationId?: string | null;
  hasMessages?: boolean;
  workspacePath?: string | null;
  userContextMode?: 'enabled' | 'off' | 'temporary';
  canChangeWorkspace?: boolean;
  workspaceDisabled?: boolean;
  onWorkspaceChange?: (path: string) => Promise<void>;
  prepareTerminalSession?: () => Promise<string | null>;
  terminalDisabled?: boolean;
  showContextControls?: boolean;
  onFindOpen?: () => void;
  projectId?: string | null;
  context?: Pick<SessionContextPanelProps, 'draftRefs' | 'draftAttachments' | 'draftPage' | 'project' | 'onLeaveProject' | 'leaveProjectLabel' | 'onDraftSourceNote' | 'draftSourceNoteLabel'>;
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
  conversationId,
  hasMessages = false,
  workspacePath,
  userContextMode = 'enabled',
  canChangeWorkspace = false,
  workspaceDisabled = false,
  onWorkspaceChange,
  prepareTerminalSession,
  terminalDisabled = false,
  showContextControls = true,
  onFindOpen,
  projectId,
  context,
}: ChatPageHeaderRegistrationProps) {
  const language = useLocaleStore((s) => s.language);
  const { conversationId: routeConversationId } = useParams();
  const routedConversationId = routeConversationId && routeConversationId !== 'new'
    ? decodeURIComponent(routeConversationId)
    : null;
  const activeConversationId = conversationId?.trim() || routedConversationId;
  const { data: contextSummary, error: contextError, mutate: refreshContext } = useSessionContext(activeConversationId ?? null, false);
  const workspaceAvailable = !contextError && (!contextSummary || Boolean(contextSummary.environment?.available));
  const m = messages(language);
  const sidebarCollapsed = useSidebarStore((s) => s.collapsed);
  const setSideChatOpen = useSideChatStore((s) => s.setOpen);
  const toggleTerminalPanel = useTerminalPanelStore((s) => s.toggle);
  const openTerminalPanel = useTerminalPanelStore((s) => s.open);
  const [shareOpen, setShareOpen] = useState(false);
  const findRequested = useRef(false);
  const [terminalPreparing, setTerminalPreparing] = useState(false);
  const mobileNavOpen = useAppShellStore((s) => s.mobileNavOpen);
  const setPageHeader = usePageHeaderStore((s) => s.setPageHeader);
  const clearPageHeader = usePageHeaderStore((s) => s.clearPageHeader);
  const terminalPlatform = window.electronAPI?.platform;
  const terminalAvailable = Boolean(showContextControls && window.electronAPI?.terminal && (activeConversationId || prepareTerminalSession));

  const handleTerminalToggle = useCallback(() => {
    if (!terminalAvailable || terminalDisabled || terminalPreparing) return;
    if (activeConversationId) {
      toggleTerminalPanel(activeConversationId);
      return;
    }
    if (!prepareTerminalSession) return;
    setTerminalPreparing(true);
    void prepareTerminalSession()
      .then((createdConversationId) => {
        if (createdConversationId) openTerminalPanel(createdConversationId);
      })
      .finally(() => setTerminalPreparing(false));
  }, [activeConversationId, openTerminalPanel, prepareTerminalSession, terminalAvailable, terminalDisabled, terminalPreparing, toggleTerminalPanel]);

  const handleSideChatToggle = useCallback(() => {
    if (!activeConversationId || !hasMessages) return;
    const pane = useRightWorkspaceStore.getState().panes[activeConversationId];
    const requested = useSideChatStore.getState().pendingCreate?.parentConversationId === activeConversationId || Boolean(useSideChatStore.getState().creatingRequests[activeConversationId]);
    const open = pane?.open === true && (pane.activeId?.startsWith('side:') === true || requested);
    setSideChatOpen(activeConversationId, !open);
  }, [activeConversationId, hasMessages, setSideChatOpen]);

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
    if (!terminalAvailable) return;
    const onKeyDown = (event: KeyboardEvent) => {
      if (!matchesTerminalShortcut(event, terminalPlatform)) return;
      event.preventDefault();
      handleTerminalToggle();
    };
    window.addEventListener('keydown', onKeyDown);
    window.addEventListener('workspace-open-terminal', handleTerminalToggle);
    return () => { window.removeEventListener('keydown', onKeyDown); window.removeEventListener('workspace-open-terminal', handleTerminalToggle); };
  }, [handleTerminalToggle, terminalAvailable, terminalPlatform]);

  useEffect(() => {
    if (!activeConversationId || !hasMessages) return;
    const onKeyDown = (event: KeyboardEvent) => {
      if (!matchesSideChatShortcut(event, terminalPlatform)) return;
      event.preventDefault();
      handleSideChatToggle();
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [activeConversationId, handleSideChatToggle, hasMessages, terminalPlatform]);

  useLayoutEffect(() => {
    setPageHeader({
      className: 'bg-surface-panel',
      startExtra: showNewChatLink ? (
        <Link
          to={newChatHrefForProject(projectId)}
          state={{ forceNewChat: true, agentId: chatAgentId, temporary: userContextMode === 'temporary' }}
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
        <div className="flex w-full min-w-0 max-w-(--max-width-chat-frame) items-center gap-3 px-3 sm:px-5 xl:px-6">
          <h1
            className={cn(
              'min-w-0 flex-1 truncate text-[0.9375rem] font-semibold leading-5 tracking-tight text-fg',
              showNewChatLink ? 'text-left md:text-center' : 'text-left',
            )}
            title={chatHeadline}
          >
            {chatHeadline}
          </h1>
          {showChatAgentSelector ? <ChatAgentSelector items={chatAgents} value={chatAgentId} disabled={chatAgentDisabled} placeholder={m.chat.agentPlaceholder} searchPlaceholder={m.chat.agentSearchPlaceholder} noMatches={m.chat.agentNoMatches} compact contentSide="bottom" contentAlign="end" onChange={onChatAgentChange} /> : null}
        </div>
      ),
      end: (
        <div
          className={cn(
            'flex min-w-0 max-w-[min(32rem,calc(100vw-8rem))] shrink-0 items-center justify-end gap-2',
            APP_CHROME_NO_DRAG_CLASS,
          )}
        >
          <DropdownMenu.Root modal={false}>
            <DropdownMenu.Trigger asChild>
              <button type="button" data-chat-menu-trigger aria-label={language === 'zh' ? '聊天菜单' : 'Chat menu'} title={language === 'zh' ? '聊天菜单' : 'Chat menu'} className="inline-flex size-8 shrink-0 items-center justify-center rounded-lg text-fg-muted transition-colors hover:bg-surface-hover data-[state=open]:bg-surface-hover focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent">
                <MoreHorizontal className="size-4" aria-hidden />
              </button>
            </DropdownMenu.Trigger>
            <DropdownMenu.Portal>
              <DropdownMenu.Content onCloseAutoFocus={(event) => {
                if (!findRequested.current) return;
                event.preventDefault();
                findRequested.current = false;
                document.querySelector<HTMLElement>('[data-chat-menu-trigger]')?.focus();
                onFindOpen?.();
              }} align="end" sideOffset={8} className="workspace-menu z-[125] min-w-60 rounded-xl border border-edge bg-surface-panel p-1.5 text-sm shadow-popover outline-none">
                <DropdownMenu.Item disabled={!hasMessages || !onFindOpen} onSelect={() => { findRequested.current = true; }} className="flex cursor-default items-center gap-3 rounded-lg px-3 py-2 text-fg outline-none data-[highlighted]:bg-surface-hover data-[disabled]:opacity-40">
                  <Search className="size-4 text-fg-muted" aria-hidden /><span className="flex-1">{m.chat.find.input}</span><span className="text-xs text-fg-muted">{terminalPlatform === 'darwin' ? '⌘F' : 'Ctrl+F'}</span>
                </DropdownMenu.Item>
                <DropdownMenu.Item disabled={!activeConversationId || !hasMessages} onSelect={() => setShareOpen(true)} className="flex cursor-default items-center gap-3 rounded-lg px-3 py-2 text-fg outline-none data-[highlighted]:bg-surface-hover data-[disabled]:opacity-40">
                  <Share2 className="size-4 text-fg-muted" aria-hidden /><span>{language === 'zh' ? '分享对话' : 'Share conversation'}</span>
                </DropdownMenu.Item>
              </DropdownMenu.Content>
            </DropdownMenu.Portal>
          </DropdownMenu.Root>
          {activeConversationId && hasMessages ? <SessionShareButton key={`share:${activeConversationId}`} conversationId={activeConversationId} hideTrigger dialogOpen={shareOpen} onDialogOpenChange={setShareOpen} /> : null}
          {showContextControls ? <SessionContextPanel
            key={`context:${activeConversationId ?? context?.project?.id ?? 'new'}`}
            {...context}
            agentId={chatAgentId}
            environmentAction={canChangeWorkspace && onWorkspaceChange ? <ChatWorkspaceControl
              directoryOnly conversationId={activeConversationId} workspacePath={activeConversationId ? workspacePath : context?.project?.workspaceRoot}
              available={workspaceAvailable} canChangeWorkspace disabled={workspaceDisabled}
              onWorkspaceChange={async (path) => { await onWorkspaceChange(path); await refreshContext(); }}
            /> : null}
            temporary={userContextMode === 'temporary'}
            conversationId={activeConversationId ?? null}
          /> : null}
          {showContextControls ? <span aria-hidden className="mx-0.5 h-6 w-px shrink-0 bg-edge-subtle" /> : null}
          {showContextControls ? (
            <ChatWorkspaceControl
              key={`workspace:${activeConversationId ?? projectId}`}
              conversationId={activeConversationId}
              workspacePath={activeConversationId ? workspacePath : context?.project?.workspaceRoot}
              available={workspaceAvailable}
              canChangeWorkspace={false}
              disabled={workspaceDisabled}
              onWorkspaceChange={async (path) => {
                await onWorkspaceChange?.(path);
                await refreshContext();
              }}
            />
          ) : null}

        </div>
      ),
    });
  }, [
    shareOpen,
    language,
    terminalPlatform,
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
    m.chat.find.input,
    m.chat.terminal.open,
    m.sidebar.newTask,
    projectId,
    context,
    terminalAvailable,
    terminalDisabled,
    showContextControls,
    terminalPreparing,
    activeConversationId,
    hasMessages,
    onFindOpen,
    setSideChatOpen,
    workspacePath,
    workspaceAvailable,
    refreshContext,
    userContextMode,
    canChangeWorkspace,
    workspaceDisabled,
    onWorkspaceChange,
    handleTerminalToggle,
    handleSideChatToggle,
    setPageHeader,
  ]);

  return null;
});
