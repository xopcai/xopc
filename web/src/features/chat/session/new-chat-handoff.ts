import { dispatchSidebarSessionFocus } from '@/lib/provisional-session-title';
import { markSkipInitialSessionLoad } from '@/features/chat/session/chat-session-init-skip-load';
import { resolveNewChatTarget } from '@/features/chat/session/resolve-new-chat-target';
import type { SessionManager } from '@/features/chat/session/session-manager';
import { addWebchatEmptyShellToCache } from '@/features/chat/session/webchat-empty-shell-cache';

export type NewChatHandoffNavigate = (
  key: string,
  replace?: boolean,
  search?: string,
) => void;

export type NewChatHandoffOpts = {
  sessionMgr: SessionManager;
  agentId?: string | null;
  projectId?: string | null;
  currentSessionKey?: string | null;
  /** Decoded route session key (`null` on `/chat/new`). Used to skip redundant noop navigation. */
  routeSessionKey?: string | null;
  forceNew?: boolean;
  navigateToSession: NewChatHandoffNavigate;
  onOpened: (sessionKey: string) => void;
  replaceNavigate?: boolean;
  search?: string;
};

let resolveInflight: Promise<string> | null = null;

/** Resolve reuse / noop / create; navigate when the target key changes. */
export function openNewChatHandoff(opts: NewChatHandoffOpts): Promise<string> {
  if (resolveInflight) {
    return resolveInflight;
  }

  const pending = (async () => {
    const agentRaw = opts.agentId ?? undefined;
    const resolution = await resolveNewChatTarget({
      sessionMgr: opts.sessionMgr,
      agentId: agentRaw?.trim() || 'main',
      projectId: opts.projectId,
      currentSessionKey: opts.currentSessionKey,
      forceNew: opts.forceNew,
    });

    if (resolution.kind === 'noop') {
      opts.onOpened(resolution.sessionKey);
      const routeKey = opts.routeSessionKey?.trim() || null;
      if (routeKey !== resolution.sessionKey) {
        opts.navigateToSession(resolution.sessionKey, opts.replaceNavigate ?? false, opts.search);
      }
      return resolution.sessionKey;
    }

    if (resolution.kind === 'reuse') {
      markSkipInitialSessionLoad(resolution.sessionKey);
      opts.onOpened(resolution.sessionKey);
      opts.navigateToSession(resolution.sessionKey, opts.replaceNavigate ?? false, opts.search);
      dispatchSidebarSessionFocus(resolution.sessionKey);
      return resolution.sessionKey;
    }

    const { sessionKey, session } = resolution;
    addWebchatEmptyShellToCache({
      key: sessionKey,
      sessionId: session.sessionId,
      name: session.name,
      messageCount: 0,
      updatedAt: session.updatedAt || new Date().toISOString(),
      sourceChannel: session.sourceChannel,
      sourceChatId: session.sourceChatId,
      projectId: session.projectId,
      routing: session.routing,
    });
    markSkipInitialSessionLoad(sessionKey);
    opts.onOpened(sessionKey);
    opts.navigateToSession(sessionKey, opts.replaceNavigate ?? false, opts.search);
    dispatchSidebarSessionFocus(sessionKey);
    return sessionKey;
  })().finally(() => {
    resolveInflight = null;
  });

  resolveInflight = pending;
  return pending;
}

/** Reset inflight guard (tests). */
export function resetNewChatHandoffInflightForTests(): void {
  resolveInflight = null;
}
