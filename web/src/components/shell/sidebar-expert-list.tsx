import { modelPreferenceForAgent } from '@xopcai/gateway-contract';
import { Loader2, MessageSquarePlus } from 'lucide-react';
import { useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react';
import { useLocation, useNavigate } from 'react-router-dom';
import { useSWRConfig } from 'swr';
import { useShallow } from 'zustand/react/shallow';

import { SidebarCreateSectionHeader } from '@/components/shell/sidebar-create-section-header';
import type { ChatAgentOption } from '@/features/chat/agent-selection/chat-agents-api';
import { useChatRunPresenceStore } from '@/features/chat/session/chat-run-presence-store';
import { chatSessionAgentContextKey, useChatSessionAgentContext } from '@/features/chat/session/chat-session-agent-context';
import { useChatSessionStore } from '@/features/chat/session/chat-session-store';
import { newAgentSetupHref } from '@/features/chat/session/composer-handoff-params';
import { findLatestLocalExpertDraft } from '@/features/chat/session/local-session-drafts';
import { navigateToNewChat } from '@/features/chat/session/new-chat-navigation';
import { readNewSessionPreferences } from '@/features/chat/session/new-session-preferences';
import { SessionManager } from '@/features/chat/session/session-manager';
import { listSessions } from '@/features/sessions/session-api';
import { AgentAvatarDisplay } from '@/features/settings/agents/agent-avatar-display';
import { agentListDisplayDescription, agentListDisplayName, isPersonalAgentId } from '@/features/settings/agents/agent-display-names';
import { messages } from '@/i18n/messages';
import { cn } from '@/lib/cn';
import { useGatewayStore } from '@/stores/gateway-store';
import { useLocaleStore } from '@/stores/locale-store';

import './sidebar-expert-list.css';

async function findLatestExpertSession(agentId: string, setupConversationIds: ReadonlySet<string>) {
  const limit = 20;
  for (let offset = 0; ; offset += limit) {
    const page = await listSessions({
      agentId,
      sources: ['workbench'],
      purposes: ['chat'],
      activity: 'manual',
      excludeArchived: true,
      rootConversationsOnly: true,
      limit,
      offset,
    });
    const session = page.items.find(item => item.customData?.agentSetup !== true && !setupConversationIds.has(item.key));
    if (session || !page.hasMore) return session;
  }
}

function ExpertReplyConversation({ conversationId, trackingKey, onResolve }: {
  conversationId: string;
  trackingKey: string;
  onResolve: (trackingKey: string, agentId?: string) => void;
}) {
  const { data } = useChatSessionAgentContext(conversationId);
  const agentId = data?.expertChat ? data.agentId : undefined;
  useEffect(() => {
    if (!agentId) return;
    onResolve(trackingKey, agentId);
    return () => onResolve(trackingKey);
  }, [agentId, trackingKey, onResolve]);
  return null;
}

export function SidebarExpertList({ agents, defaultAgentId, activeConversationId, onNavigate }: {
  agents: ChatAgentOption[];
  defaultAgentId: string;
  activeConversationId?: string;
  onNavigate?: () => void;
}) {
  const language = useLocaleStore((s) => s.language);
  const { sidebar, agentsSettings } = messages(language);
  const navigate = useNavigate();
  const { key: locationKey, pathname, search } = useLocation();
  const isAgentSetup = Boolean(activeConversationId || pathname === '/chat/new')
    && new URLSearchParams(search).get('agentSetup') === '1';
  const { data: activeChat } = useChatSessionAgentContext(activeConversationId);
  const activeExpertId = isAgentSetup || activeChat?.agentSetup ? undefined : activeChat?.agentId;
  const { mutate } = useSWRConfig();
  const gatewaySession = useGatewayStore((s) => s.conversationId);
  const runningConversationIds = useChatRunPresenceStore(useShallow((state) => (
    Object.keys(state.runs).filter((id) => state.runs[id]?.status === 'running')
  )));
  const [replyingConversations, setReplyingConversations] = useState(() => new Map<string, string>());
  const recordReplyingConversation = useCallback((trackingKey: string, agentId?: string) => {
    setReplyingConversations((current) => {
      if (current.get(trackingKey) === agentId) return current;
      const next = new Map(current);
      if (agentId) next.set(trackingKey, agentId);
      else next.delete(trackingKey);
      return next;
    });
  }, []);
  const replyConversations = gatewaySession ? runningConversationIds
    .filter((id) => !(id === activeConversationId && isAgentSetup))
    .map((id) => ({ id, trackingKey: JSON.stringify([gatewaySession, id]) })) : [];
  const replyingExperts = new Set(replyConversations.map(({ trackingKey }) => replyingConversations.get(trackingKey)));
  const [openingId, setOpeningId] = useState<string>();
  const [failedId, setFailedId] = useState<string>();
  const pending = useRef<object | null>(null);
  const setupConversationIds = useRef(new Set<string>());
  useLayoutEffect(() => {
    setOpeningId(undefined);
    setFailedId(undefined);
    return () => { pending.current = null; };
  }, [locationKey, gatewaySession]);

  const experts = agents
    .filter(({ id, purpose }) => id !== 'task-router' && !isPersonalAgentId(id) && purpose !== 'task_dispatcher')
    .sort((a, b) => Number(b.id === 'main') - Number(a.id === 'main'));

  async function openExpert(agentId: string, forceNew = false) {
    if (pending.current) return;
    const request = {};
    pending.current = request;
    setOpeningId(agentId);
    setFailedId(undefined);
    try {
      let conversationId: string | undefined;
      let projectId: string | null = null;
      let created = false;
      if (!forceNew) {
        // Setup chats created before the metadata flag can still be identified by their URL.
        if (activeConversationId && isAgentSetup) {
          setupConversationIds.current.add(activeConversationId);
        }
        const [session, draft] = await Promise.all([
          findLatestExpertSession(agentId, setupConversationIds.current),
          findLatestLocalExpertDraft(agentId, setupConversationIds.current).catch(() => undefined),
        ]);
        if (draft && (!session || Date.parse(draft.createdAt) > Date.parse(session.updatedAt))) {
          conversationId = draft.conversationId;
        } else if (session) {
          conversationId = session.key;
          projectId = session.projectId ?? null;
        }
      }

      if (pending.current !== request) return;
      if (!conversationId) {
        const preference = modelPreferenceForAgent(readNewSessionPreferences(), agentId);
        const draft = await new SessionManager().createSession({
          agentId,
          projectId: null,
          initialAgentConfig: preference
            ? { model: preference.modelRef, thinkingLevel: preference.thinkingLevel }
            : undefined,
        });
        if (pending.current !== request) return;
        conversationId = draft.key;
        created = true;
        useChatSessionStore.getState().setCommittedSnapshot(conversationId, { messages: [], hasMore: false, name: null });
      }

      if (conversationId === activeConversationId) {
        onNavigate?.();
        return;
      }

      // Seed the destination header before navigation to avoid showing the previous chat's agent.
      void mutate(chatSessionAgentContextKey(gatewaySession, conversationId), { agentId, projectId, expertChat: true }, { revalidate: false });
      const href = `/chat/${encodeURIComponent(conversationId)}`;
      if (created) {
        navigateToNewChat(navigate, href, undefined, onNavigate);
      } else {
        onNavigate?.();
        void navigate(href);
      }
    } catch {
      if (pending.current === request) setFailedId(agentId);
    } finally {
      if (pending.current === request) {
        pending.current = null;
        setOpeningId(undefined);
      }
    }
  }

  return (
    <>
      {replyConversations.map(({ id, trackingKey }) => (
        <ExpertReplyConversation key={trackingKey} conversationId={id} trackingKey={trackingKey} onResolve={recordReplyingConversation} />
      ))}
      <SidebarCreateSectionHeader
        label={sidebar.sessionViewExperts}
        createLabel={sidebar.createExpert}
        current={isAgentSetup}
        className="px-2"
        disabled={openingId !== undefined}
        onCreate={() => navigateToNewChat(
          navigate,
          newAgentSetupHref(),
          { state: { forceNewChat: true, agentId: defaultAgentId } },
          onNavigate,
        )}
      />
      {experts.length === 0 ? <p className="px-2 py-3 text-xs text-fg-muted">{sidebar.expertsEmpty}</p> : null}
      <ul className="space-y-0.5" aria-label={sidebar.sessionViewExperts}>
        {experts.map((agent) => {
          const name = agentListDisplayName(agent, agentsSettings);
          const description = agentListDisplayDescription(agent, agentsSettings);
          const newLabel = sidebar.expertNewConversation.replace('{{name}}', name);
          const active = agent.id === activeExpertId;
          const replying = replyingExperts.has(agent.id);
          return (
            <li key={agent.id}>
              <div className={cn(
                'group relative flex min-w-0 items-center rounded-lg transition-colors duration-200 ease-out',
                active
                  ? 'bg-accent-soft before:pointer-events-none before:absolute before:inset-y-2 before:left-0 before:w-0.5 before:rounded-full before:bg-accent'
                  : 'hover:bg-surface-hover',
              )}>
                <button
                  type="button"
                  className={cn(
                    'flex min-w-0 flex-1 items-center gap-2 rounded-lg py-1.5 pl-2 text-left focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent disabled:cursor-wait',
                    replying ? 'pr-[4.5rem]' : 'pr-9',
                  )}
                  disabled={openingId !== undefined}
                  aria-busy={openingId === agent.id}
                  aria-current={active ? 'page' : undefined}
                  onClick={() => void openExpert(agent.id)}
                >
                  <AgentAvatarDisplay agentId={agent.id} avatar={agent.avatar} size={24} className="size-6 shrink-0" />
                  <span className="flex min-w-0 flex-1 flex-col">
                    <span className="truncate text-sm text-fg">{name}</span>
                    {description ? <span className="truncate text-xs text-fg-muted" title={description}>{description}</span> : null}
                  </span>
                  {replying ? (
                    <span
                      className="absolute right-1.5 top-1/2 flex h-[18px] w-[30px] -translate-y-1/2 items-center justify-center gap-[3px] rounded-full bg-accent/10 text-accent-fg"
                      title={sidebar.expertReplying}
                    >
                      <span className="sr-only">{sidebar.expertReplying}</span>
                      <i className="expert-reply-dot" aria-hidden />
                      <i className="expert-reply-dot" aria-hidden />
                      <i className="expert-reply-dot" aria-hidden />
                    </span>
                  ) : null}
                </button>
                <div className={cn(
                  'absolute inset-y-0 z-10 flex items-center transition-opacity',
                  replying ? 'right-10' : 'right-1',
                  openingId !== agent.id &&
                    'pointer-events-none opacity-0 group-hover:pointer-events-auto group-hover:opacity-100 group-has-[:focus-visible]:opacity-100 [@media(hover:none)]:pointer-events-auto [@media(hover:none)]:opacity-100',
                )}>
                  <button
                    type="button"
                    onClick={() => void openExpert(agent.id, true)}
                    disabled={openingId !== undefined}
                    aria-label={newLabel}
                    title={newLabel}
                    className="flex h-8 w-6 shrink-0 items-center justify-center rounded-lg text-fg-muted hover:bg-surface-hover hover:text-fg focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent focus-visible:ring-offset-2 focus-visible:ring-offset-surface-base"
                  >
                    {openingId === agent.id
                      ? <Loader2 className="size-4 animate-spin motion-reduce:animate-none" aria-hidden />
                      : <MessageSquarePlus className="size-4" strokeWidth={1.75} aria-hidden />}
                  </button>
                </div>
              </div>
              {failedId === agent.id ? <p role="alert" className="px-2 py-1 text-xs text-fg-muted">{sidebar.expertConversationError}</p> : null}
            </li>
          );
        })}
      </ul>
    </>
  );
}
