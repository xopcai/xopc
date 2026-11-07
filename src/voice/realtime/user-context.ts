import type { Config } from '../../config/schema.js';
import { getConversation } from '../../routing/session-key.js';
import { resolveUserContextSessionAccess } from '../../user-context/access-policy.js';
import { getUserProfileContext } from '../../user-model/profile.js';
import type { AgentMessage } from '@earendil-works/pi-agent-core';
import { explicitConversationName } from './identity-grounding.js';

export interface VoiceUserSnapshot {
  block: string;
  preferredCallName?: string;
  preferredCallNameObservedAt?: number;
  isCurrent: () => boolean;
}

const MAX_USER_CHARS = 800;

/** Pinned owner profile, independent of query relevance, optional retrieval and chat-history clipping. */
export function buildVoiceUserContext(input: {
  getConfig: () => Config;
  conversationId: string;
  history?: readonly AgentMessage[];
}): VoiceUserSnapshot | undefined {
  const read = () => {
    const config = input.getConfig();
    const access = resolveUserContextSessionAccess(config, input.conversationId);
    const conversation = getConversation(input.conversationId);
    if (!access.userModel || conversation?.sessionType !== 'chat') return undefined;
    return getUserProfileContext(conversation.agentId);
  };
  const rows = read();
  if (!rows) return;
  const profile: Record<string, string> = {};
  const savedName = rows.find(row => row.field === 'callName');
  const named = savedName ? explicitConversationName(input.history ?? [], savedName.assertion.observedAt) : undefined;
  const omittedFields: string[] = [];
  const serialize = () => JSON.stringify({ currentUser: {
    relationship: 'conversation_owner', profile, nameKnown: Boolean(profile.callName), omittedFields,
  } });
  for (const row of rows) {
    profile[row.field] = row.field === 'callName' && named ? named.name : row.value;
    if (serialize().length > MAX_USER_CHARS - 100) {
      delete profile[row.field];
      omittedFields.push(row.field);
    }
  }
  if (named && !profile.callName && named.name.length <= 80) profile.callName = named.name;
  const version = JSON.stringify(rows.map(row => [row.field, row.assertion.id, row.assertion.recordedAt, row.value]));
  return { block: serialize(), preferredCallName: profile.callName,
    preferredCallNameObservedAt: profile.callName ? named?.at ?? savedName?.assertion.observedAt : undefined,
    isCurrent: () => {
    try {
      const current = read();
      return Boolean(current) && JSON.stringify(current!.map(row =>
        [row.field, row.assertion.id, row.assertion.recordedAt, row.value])) === version;
    } catch { return false; }
  } };
}
