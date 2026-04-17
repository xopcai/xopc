import { FolderOpen, Plus } from 'lucide-react';
import { memo, useEffect, useLayoutEffect, useState } from 'react';
import { Link } from 'react-router-dom';

import { APP_CHROME_NO_DRAG_CLASS } from '@/components/shell/app-chrome';
import { ChatAgentSelector } from '@/features/chat/chat-agent-selector';
import { ModelSelector } from '@/features/chat/model-selector';
import type { ChatAgentOption } from '@/features/chat/chat-agents-api';
import { messages } from '@/i18n/messages';
import { cn } from '@/lib/cn';
import { useAppShellStore } from '@/stores/app-shell-store';
import { usePageHeaderStore } from '@/stores/page-header-store';
import { useLocaleStore } from '@/stores/locale-store';
import { useSidebarStore } from '@/stores/sidebar-store';
import { useWorkspacePanelStore } from '@/stores/workspace-panel-store';

const MAX_MD = '(max-width: 767px)';

type ChatPageHeaderRegistrationProps = {
  chatHeadline: string;
  sessionModel: string;
  showModelSelector: boolean;
  onModelChange: (modelId: string) => void;
  modelDisabled: boolean;
  chatAgents: ChatAgentOption[];
  showChatAgentSelector: boolean;
  chatAgentId: string;
  onChatAgentChange: (agentId: string) => void;
  chatAgentDisabled: boolean;
};

/**
 * Registers chat title / model / new-task link into `page-header-store` for {@link PrimaryAppHeader}.
 */
export const ChatPageHeaderRegistration = memo(function ChatPageHeaderRegistration({
  chatHeadline,
  sessionModel,
  showModelSelector,
  onModelChange,
  modelDisabled,
  chatAgents,
  showChatAgentSelector,
  chatAgentId,
  onChatAgentChange,
  chatAgentDisabled,
}: ChatPageHeaderRegistrationProps) {
  const language = useLocaleStore((s) => s.language);
  const m = messages(language);
  const sidebarCollapsed = useSidebarStore((s) => s.collapsed);
  const workspacePanelOpen = useWorkspacePanelStore((s) => s.open);
  const toggleWorkspacePanel = useWorkspacePanelStore((s) => s.toggleOpen);
  const mobileNavOpen = useAppShellStore((s) => s.mobileNavOpen);
  const setPageHeader = usePageHeaderStore((s) => s.setPageHeader);
  const clearPageHeader = usePageHeaderStore((s) => s.clearPageHeader);

  const [isMobileLayout, setIsMobileLayout] = useState(() =>
    typeof globalThis.matchMedia === 'function' ? globalThis.matchMedia(MAX_MD).matches : false,
  );
  useEffect(() => {
    const mq = globalThis.matchMedia(MAX_MD);
    const onChange = () => setIsMobileLayout(mq.matches);
    onChange();
    mq.addEventListener('change', onChange);
    return () => mq.removeEventListener('change', onChange);
  }, []);

  const showNewChatLink = isMobileLayout ? !mobileNavOpen : sidebarCollapsed;

  useLayoutEffect(() => {
    setPageHeader({
      startExtra: showNewChatLink ? (
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
      ) : null,
      main: (
        <div className="w-full min-w-0 max-w-[var(--max-width-chat)] px-3 sm:px-5 xl:px-6">
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
            <div className="min-w-0 w-fit max-w-[min(10rem,calc(100vw-12rem))] shrink-0">
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
          {showModelSelector ? (
            <div className={cn('min-w-0 w-fit max-w-[min(20rem,calc(100vw-10rem))] shrink-0')}>
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
                showProviderSettingsFooter
                onChange={onModelChange}
              />
            </div>
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
            onClick={toggleWorkspacePanel}
          >
            <FolderOpen className="size-4" />
          </button>
        </div>
      ),
    });
    return () => clearPageHeader();
  }, [
    chatHeadline,
    sessionModel,
    showModelSelector,
    onModelChange,
    modelDisabled,
    chatAgents,
    showChatAgentSelector,
    chatAgentId,
    onChatAgentChange,
    chatAgentDisabled,
    showNewChatLink,
    m.chat.modelPlaceholder,
    m.chat.modelSearchPlaceholder,
    m.chat.modelNoMatches,
    m.chat.modelProviderSettingsLink,
    m.chat.agentPlaceholder,
    m.chat.agentSearchPlaceholder,
    m.chat.agentNoMatches,
    m.sidebar.newTask,
    m.workspace.openFiles,
    workspacePanelOpen,
    toggleWorkspacePanel,
    setPageHeader,
    clearPageHeader,
  ]);

  return null;
});
