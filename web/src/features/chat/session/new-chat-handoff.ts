import type { SessionInfo } from '@/features/chat/chat.types';
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
  currentSessionKey?: string | null;
  forceNew?: boolean;
  navigateToSession: NewChatHandoffNavigate;
  onOpened: (sessionKey: string) => void;
  followRegistration?: (ctx: {
    sessionKey: string;
    register: Promise<SessionInfo>;
    replaceNavigate?: boolean;
    search?: string;
  }) => void;
  replaceNavigate?: boolean;
  search?: string;
};

let resolveInflight: Promise<string> | null = null;

/** Resolve reuse / noop / optimistic create; navigate when the target key changes. */
export function openNewChatHandoff(opts: NewChatHandoffOpts): Promise<string> {
  if (resolveInflight) {
    return resolveInflight;
  }

  const pending = (async () => {
    const agentRaw = opts.agentId ?? undefined;
    const resolution = await resolveNewChatTarget({
      sessionMgr: opts.sessionMgr,
      agentId: agentRaw?.trim() || 'main',
      currentSessionKey: opts.currentSessionKey,
      forceNew: opts.forceNew,
    });

    if (resolution.kind === 'noop') {
      opts.onOpened(resolution.sessionKey);
      opts.navigateToSession(resolution.sessionKey, opts.replaceNavigate ?? false, opts.search);
      return resolution.sessionKey;
    }

    if (resolution.kind === 'reuse') {
      markSkipInitialSessionLoad(resolution.sessionKey);
      opts.onOpened(resolution.sessionKey);
      opts.navigateToSession(resolution.sessionKey, opts.replaceNavigate ?? false, opts.search);
      dispatchSidebarSessionFocus(resolution.sessionKey);
      return resolution.sessionKey;
    }

    const { sessionKey, register } = resolution;
    addWebchatEmptyShellToCache({
      key: sessionKey,
      messageCount: 0,
      updatedAt: new Date().toISOString(),
    });
    markSkipInitialSessionLoad(sessionKey);
    opts.onOpened(sessionKey);
    opts.navigateToSession(sessionKey, opts.replaceNavigate ?? false, opts.search);
    dispatchSidebarSessionFocus(sessionKey);
    opts.followRegistration?.({
      sessionKey,
      register,
      replaceNavigate: opts.replaceNavigate,
      search: opts.search,
    });
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
