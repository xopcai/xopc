import { Plus } from 'lucide-react';
import { memo, useCallback, useEffect, useLayoutEffect, useMemo, useState } from 'react';
import { useParams } from 'react-router-dom';

import { APP_CHROME_NO_DRAG_CLASS } from '@/components/shell/app-chrome';
import { getShellChromeRuntime, resolveShellChromeLayout } from '@/components/shell/chrome-layout';
import { ChatAgentSelector } from '@/features/chat/agent-selection/chat-agent-selector';
import type { ChatAgentOption } from '@/features/chat/agent-selection/chat-agents-api';
import { SessionContextPanel, type SessionContextPanelProps } from '@/features/chat/context/session-context-panel';
import { useSessionContext } from '@/features/chat/context/use-session-context';
import { BrowserPreviewButton } from '@/features/browser-preview/browser-preview-button';
import { ComputerChatButton } from '@/features/chat/computer/computer-chat-button';
import { ExecutionDevicePicker } from '@/features/endpoint-tools/execution-device-picker';
import { PhoneChatButton } from '@/features/phone/phone-chat-button';
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
import { NewChatLink } from '@/features/chat/session/new-chat-navigation';
import { newChatHrefForProject } from '@/features/chat/session/composer-handoff-params';
import { ChatTitleMenu } from '@/features/chat/chat-title-menu';

const MAX_MD = '(max-width: 767px)';

type ChatPageHeaderRegistrationProps = {
  inline?: boolean;
  chatHeadline: string;
  chatAgents: ChatAgentOption[];
  showChatAgentSelector: boolean;
  chatAgentId: string;
  onChatAgentChange: (agentId: string) => void;
  chatAgentDisabled: boolean;
  conversationId?: string | null;
  hasMessages?: boolean;
  pinned?: boolean;
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
 * Shares chat chrome between the shell header and embedded conversation headers.
 */
export const ChatPageHeaderRegistration = memo(function ChatPageHeaderRegistration({
  inline = false,
  chatHeadline,
  chatAgents,
  showChatAgentSelector,
  chatAgentId,
  onChatAgentChange,
  chatAgentDisabled,
  conversationId,
  hasMessages = false,
  pinned,
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
  const workspaceOpen = useRightWorkspaceStore((s) => s.panes[activeConversationId ?? 'new']?.open === true);
  const m = messages(language);
  const sidebarCollapsed = useSidebarStore((s) => s.collapsed);
  const setSideChatOpen = useSideChatStore((s) => s.setOpen);
  const toggleTerminalPanel = useTerminalPanelStore((s) => s.toggle);
  const openTerminalPanel = useTerminalPanelStore((s) => s.open);
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
  useLayoutEffect(() => {
    if (!inline) return () => clearPageHeader();
  }, [clearPageHeader, inline]);

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

  const selectedChatAgent = useMemo(
    () => chatAgents.find((agent) => agent.id === chatAgentId),
    [chatAgents, chatAgentId],
  );

  const header = useMemo(() => ({
      startExtra: showNewChatLink ? (
        <NewChatLink
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
        </NewChatLink>
      ) : null,
      main: (
        <div className="flex w-full min-w-0 max-w-(--max-width-chat-frame) items-center gap-3 px-3 sm:px-5 xl:px-6">
          <ChatTitleMenu
            key={activeConversationId}
            title={chatHeadline}
            centered={showNewChatLink}
            conversationId={activeConversationId}
            hasMessages={hasMessages}
            pinned={pinned}
            onFindOpen={onFindOpen}
          />
        </div>
      ),
      end: (
        <div className="flex min-w-0 max-w-[min(32rem,calc(100vw-8rem))] shrink-0 items-center justify-end gap-2">
          {showChatAgentSelector ? <ChatAgentSelector items={chatAgents} value={chatAgentId} disabled={chatAgentDisabled} placeholder={m.chat.agentPlaceholder} newChatLabel={activeConversationId ? m.chat.agentStartNewChat : undefined} searchPlaceholder={m.chat.agentSearchPlaceholder} noMatches={m.chat.agentNoMatches} compact contentSide="bottom" contentAlign="end" onChange={onChatAgentChange} /> : null}
          {showContextControls ? <SessionContextPanel
            key={`context:${activeConversationId ?? context?.project?.id ?? 'new'}`}
            {...context}
            agentId={chatAgentId}
            externalRuntime={selectedChatAgent?.execution}
            externalContextAccess={selectedChatAgent?.contextAccess}
            executionDeviceAction={activeConversationId ? <ExecutionDevicePicker conversationId={activeConversationId} disabled={chatAgentDisabled} /> : null}
            environmentAction={canChangeWorkspace && onWorkspaceChange ? <ChatWorkspaceControl
              directoryOnly conversationId={activeConversationId} workspacePath={activeConversationId ? workspacePath : context?.project?.workspaceRoot}
              available={workspaceAvailable} canChangeWorkspace disabled={workspaceDisabled}
              onWorkspaceChange={async (path) => { await onWorkspaceChange(path); await refreshContext(); }}
            /> : null}
            temporary={userContextMode === 'temporary'}
            conversationId={activeConversationId ?? null}
          /> : null}
          {showContextControls && !workspaceOpen ? <span aria-hidden className="mx-0.5 h-6 w-px shrink-0 bg-edge-subtle" /> : null}
          {activeConversationId ? <BrowserPreviewButton conversationId={activeConversationId} /> : null}
          {activeConversationId ? <ComputerChatButton key={activeConversationId} conversationId={activeConversationId} /> : null}
          {activeConversationId ? <PhoneChatButton conversationId={activeConversationId} /> : null}
          {showContextControls && !workspaceOpen ? (
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
  }), [
    chatHeadline,
    chatAgents,
    selectedChatAgent,
    showChatAgentSelector,
    chatAgentId,
    onChatAgentChange,
    chatAgentDisabled,
    showNewChatLink,
    m.chat.agentPlaceholder,
    m.chat.agentSearchPlaceholder,
    m.chat.agentNoMatches,
    m.chat.terminal.open,
    m.sidebar.newTask,
    projectId,
    context,
    terminalAvailable,
    terminalDisabled,
    showContextControls,
    workspaceOpen,
    terminalPreparing,
    activeConversationId,
    hasMessages,
    pinned,
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
  ]);

  useLayoutEffect(() => {
    if (!inline) setPageHeader(header);
  }, [header, inline, setPageHeader]);

  return inline ? <header aria-label={language === 'zh' ? '聊天工具栏' : 'Chat toolbar'} className="flex min-h-14 shrink-0 items-center justify-between gap-2 border-b border-edge-subtle px-3 py-2">
    <div className="min-w-0 flex-1">{header.main}</div>
    {header.end}
  </header> : null;
});
