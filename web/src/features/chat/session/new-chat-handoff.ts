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
  currentConversationId?: string | null;
  /** Decoded route session key (`null` on `/chat/new`). Used to skip redundant noop navigation. */
  routeConversationId?: string | null;
  forceNew?: boolean;
  temporary?: boolean;
  initialAgentConfig?: SessionInitialAgentConfig;
  executionMode?: SessionCreateRequest['executionMode'];
  navigateToSession: NewChatHandoffNavigate;
  onOpened: (conversationId: string) => void;
  replaceNavigate?: boolean;
  search?: string;
};

const inflightByScope = new Map<string, {
  promise: Promise<string>;
  target: { opts: NewChatHandoffOpts; generation: number };
}>();
let latestHandoffGeneration = 0;

/** Resolve reuse / noop / create; navigate when the target key changes. */
export function openNewChatHandoff(opts: NewChatHandoffOpts): Promise<string> {
  const gateway = useGatewayStore.getState();
  const scopeKey = newSessionCacheKey(gateway.baseUrl, {
    agentId: opts.agentId?.trim() || 'main',
    projectId: opts.projectId ?? null,
  });
  const cacheKey = JSON.stringify([scopeKey, gateway.conversationId, opts.forceNew === true, opts.temporary === true, opts.executionMode, opts.search]);
  const existing = inflightByScope.get(cacheKey);
  if (existing) {
    existing.target.opts = opts;
    existing.target.generation = ++latestHandoffGeneration;
    return existing.promise;
  }
  const target = { opts, generation: ++latestHandoffGeneration };
  const applyOpened = (conversationId: string) => {
    if (target.generation !== latestHandoffGeneration) return;
    // A replay shares creation, but its callbacks replace the cancelled caller's closures.
    const current = target.opts;
    current.onOpened(conversationId);
    const routeKey = current.routeConversationId?.trim() || null;
    if (routeKey !== conversationId) {
      current.navigateToSession(conversationId, current.replaceNavigate ?? false, current.search);
    }
  };

  const pending = (async () => {
    const agentRaw = opts.agentId ?? undefined;
    const resolution = await resolveNewChatTarget({
      sessionMgr: opts.sessionMgr,
      agentId: agentRaw?.trim() || 'main',
      projectId: opts.projectId,
      currentConversationId: opts.currentConversationId,
      forceNew: opts.forceNew,
      temporary: opts.temporary,
      initialAgentConfig: opts.initialAgentConfig,
      executionMode: opts.executionMode,
    });

    if (resolution.kind !== 'create' && opts.initialAgentConfig) {
      await opts.sessionMgr.patchSessionAgentConfig(
        resolution.conversationId,
        opts.initialAgentConfig,
      );
    }

    if (resolution.kind === 'noop') {
      applyOpened(resolution.conversationId);
      return resolution.conversationId;
    }

    if (resolution.kind === 'reuse') {
      applyOpened(resolution.conversationId);
      return resolution.conversationId;
    }

    const { conversationId, session } = resolution;
    if (!opts.executionMode) addWebchatEmptyShellToCache({
      key: conversationId,
      agentId: session.agentId,
      customData: session.customData,
      transcriptId: session.transcriptId,
      name: session.name,
      messageCount: 0,
      updatedAt: session.updatedAt || new Date().toISOString(),
      sourceChannel: session.sourceChannel,
      sourceChatId: session.sourceChatId,
      projectId: session.projectId,
      routing: session.routing,
    });
    applyOpened(conversationId);
    return conversationId;
  })().finally(() => {
    inflightByScope.delete(cacheKey);
  });

  inflightByScope.set(cacheKey, { promise: pending, target });
  return pending;
}

/** Reset inflight guard (tests). */
export function resetNewChatHandoffInflightForTests(): void {
  inflightByScope.clear();
  latestHandoffGeneration = 0;
}
