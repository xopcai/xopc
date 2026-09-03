import { resolveNewChatTarget } from '@/features/chat/session/resolve-new-chat-target';
import { newSessionCacheKey, type SessionCreateRequest, type SessionInitialAgentConfig } from '@xopcai/gateway-contract';
import type { SessionManager } from '@/features/chat/session/session-manager';
import { addWebchatEmptyShellToCache } from '@/features/chat/session/webchat-empty-shell-cache';
import { useGatewayStore } from '@/stores/gateway-store';

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
  temporary?: boolean;
  initialAgentConfig?: SessionInitialAgentConfig;
  executionMode?: SessionCreateRequest['executionMode'];
  navigateToSession: NewChatHandoffNavigate;
  onOpened: (sessionKey: string) => void;
  replaceNavigate?: boolean;
  search?: string;
};

const inflightByScope = new Map<string, Promise<string>>();
let latestHandoffGeneration = 0;

/** Resolve reuse / noop / create; navigate when the target key changes. */
export function openNewChatHandoff(opts: NewChatHandoffOpts): Promise<string> {
  const gateway = useGatewayStore.getState();
  const scopeKey = newSessionCacheKey(gateway.baseUrl, {
    agentId: opts.agentId?.trim() || 'main',
    projectId: opts.projectId ?? null,
  });
  const cacheKey = JSON.stringify([scopeKey, gateway.token, opts.forceNew === true, opts.temporary === true, opts.executionMode, opts.search]);
  const existing = inflightByScope.get(cacheKey);
  if (existing) return existing;
  const generation = ++latestHandoffGeneration;
  const applyOpened = (sessionKey: string) => {
    if (generation !== latestHandoffGeneration) return;
    opts.onOpened(sessionKey);
    const routeKey = opts.routeSessionKey?.trim() || null;
    if (routeKey !== sessionKey) {
      opts.navigateToSession(sessionKey, opts.replaceNavigate ?? false, opts.search);
    }
  };

  const pending = (async () => {
    const agentRaw = opts.agentId ?? undefined;
    const resolution = await resolveNewChatTarget({
      sessionMgr: opts.sessionMgr,
      agentId: agentRaw?.trim() || 'main',
      projectId: opts.projectId,
      currentSessionKey: opts.currentSessionKey,
      forceNew: opts.forceNew,
      temporary: opts.temporary,
      initialAgentConfig: opts.initialAgentConfig,
      executionMode: opts.executionMode,
    });

    if (resolution.kind !== 'create' && opts.initialAgentConfig) {
      await opts.sessionMgr.patchSessionAgentConfig(
        resolution.sessionKey,
        opts.initialAgentConfig,
      );
    }

    if (resolution.kind === 'noop') {
      applyOpened(resolution.sessionKey);
      return resolution.sessionKey;
    }

    if (resolution.kind === 'reuse') {
      applyOpened(resolution.sessionKey);
      return resolution.sessionKey;
    }

    const { sessionKey, session } = resolution;
    if (!opts.executionMode) addWebchatEmptyShellToCache({
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
    applyOpened(sessionKey);
    return sessionKey;
  })().finally(() => {
    inflightByScope.delete(cacheKey);
  });

  inflightByScope.set(cacheKey, pending);
  return pending;
}

/** Reset inflight guard (tests). */
export function resetNewChatHandoffInflightForTests(): void {
  inflightByScope.clear();
  latestHandoffGeneration = 0;
}
