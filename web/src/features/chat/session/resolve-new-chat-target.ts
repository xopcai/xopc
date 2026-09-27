import type { SessionInfo } from '@/features/chat/chat.types';
import type { LocalSessionOptions, SessionInitialAgentConfig } from '@xopcai/gateway-contract';
import type { SessionManager } from './session-manager';

export type NewChatResolution = { kind: 'create'; conversationId: string; session: SessionInfo };

export async function resolveNewChatTarget(opts: {
  sessionMgr: SessionManager;
  agentId: string;
  projectId?: string | null;
  currentConversationId?: string | null;
  forceNew?: boolean;
  temporary?: boolean;
  initialAgentConfig?: SessionInitialAgentConfig;
  executionMode?: LocalSessionOptions['executionMode'];
}): Promise<NewChatResolution> {
  const session = await opts.sessionMgr.createSession(opts);
  return { kind: 'create', conversationId: session.key, session };
}
