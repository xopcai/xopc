import type { ChatAgentOption } from '@/features/chat/agent-selection/chat-agents-api';
import { getAgentIdFromWebSessionKey } from '@/lib/web-session-agent';

import type { SessionMetadata } from './session.types';

export function resolveSessionAgentId(session: SessionMetadata, defaultAgentId: string): string {
  const fromRouting = session.routing?.agentId?.trim().toLowerCase();
  if (fromRouting) return fromRouting;
  const fromKey = getAgentIdFromWebSessionKey(session.key);
  if (fromKey) return fromKey;
  const d = defaultAgentId.trim().toLowerCase();
  return d || 'main';
}

export function agentAvatarFromOptions(agentId: string, items: ChatAgentOption[]): string | undefined {
  return items.find((i) => i.id === agentId)?.avatar;
}
