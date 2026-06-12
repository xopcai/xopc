import type { SessionInfo } from '@/features/chat/chat.types';
import { markSkipInitialSessionLoad } from '@/features/chat/session/chat-session-init-skip-load';
import type { SessionManager } from '@/features/chat/session/session-manager';

export type OptimisticNewSessionNavigate = (
  key: string,
  replace?: boolean,
  search?: string,
) => void;

/** Client-generated key + navigate now; POST registration runs in the background. */
export function openOptimisticNewSessionHandoff(opts: {
  sessionMgr: SessionManager;
  agentId?: string | null | undefined;
  navigateToSession: OptimisticNewSessionNavigate;
  onOpened: (sessionKey: string) => void;
  followRegistration: (ctx: {
    sessionKey: string;
    register: Promise<SessionInfo>;
    replaceNavigate?: boolean;
    search?: string;
  }) => void;
  replaceNavigate?: boolean;
  search?: string;
}): string {
  const { sessionKey, register } = opts.sessionMgr.openOptimisticNewSession(opts.agentId ?? undefined);
  markSkipInitialSessionLoad(sessionKey);
  opts.onOpened(sessionKey);
  opts.navigateToSession(sessionKey, opts.replaceNavigate ?? false, opts.search);
  opts.followRegistration({
    sessionKey,
    register,
    replaceNavigate: opts.replaceNavigate,
    search: opts.search,
  });
  return sessionKey;
}

/** Reconcile server key, surface registration failures, optional metadata hooks. */
export function followOptimisticSessionRegistration(opts: {
  sessionKey: string;
  register: Promise<SessionInfo>;
  navigateToSession: OptimisticNewSessionNavigate;
  replaceNavigate?: boolean;
  search?: string;
  isActive?: () => boolean;
  onError: (message: string) => void;
  onReconciled?: (registeredKey: string, session: SessionInfo) => void;
  onRegistered?: (sessionKey: string, session: SessionInfo) => void;
}): void {
  void opts.register
    .then((session) => {
      if (opts.isActive && !opts.isActive()) return;
      const registeredKey = (session.key ?? '').trim();
      if (!registeredKey) return;

      if (registeredKey !== opts.sessionKey) {
        markSkipInitialSessionLoad(registeredKey);
        opts.navigateToSession(registeredKey, opts.replaceNavigate ?? true, opts.search);
        opts.onReconciled?.(registeredKey, session);
        return;
      }

      opts.onRegistered?.(opts.sessionKey, session);
    })
    .catch((err) => {
      if (opts.isActive && !opts.isActive()) return;
      const msg = err instanceof Error ? err.message : 'Could not register session';
      opts.onError(msg);
    });
}
