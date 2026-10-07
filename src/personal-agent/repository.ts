import { createHash } from 'node:crypto';

import { AgentCatalogRepository } from '../agent-catalog/repository.js';
import type { StoredAgent } from '../agent-catalog/types.js';
import { isXopcDatabaseOpen } from '../storage/sqlite/connection.js';
import { getSessionConfig } from '../storage/sqlite/config-repository.js';
import { getSqliteDatabase } from '../storage/sqlite/transaction.js';

export type PersonalAgentState = 'provisioning' | 'ready' | 'error';
export type PersonalAppearance = 'spark' | 'cloud' | 'bean';

export interface PersonalAgentRecord {
  ownerId: string;
  agentId: string;
  conversationId: string;
  state: PersonalAgentState;
  displayName: string;
  appearance: PersonalAppearance;
  preferences: Record<string, unknown>;
  revision: number;
  errorMessage: string | null;
}

export const DEFAULT_PERSONAL_PREFERENCES = {
  warmth: 'balanced', humor: 'none', supportMode: 'untangle', detailLevel: 'balanced', proactivity: 'decisions',
} as const;

export function personalAgentId(ownerId: string): string {
  return `personal-${createHash('sha256').update(ownerId).digest('hex').slice(0, 12)}`;
}

export function personalConversationId(ownerId: string): string {
  const hash = createHash('sha256').update(`personal-conversation:${ownerId}`).digest('hex');
  return `${hash.slice(0, 8)}-${hash.slice(8, 12)}-5${hash.slice(13, 16)}-8${hash.slice(17, 20)}-${hash.slice(20, 32)}`;
}

type PersonalSession = { conversation_id: string; agent_id: string };

function personalSession(column: 'agent_id' | 'conversation_id', value: string): PersonalSession | null {
  if (!isXopcDatabaseOpen()) return null;
  const row = getSqliteDatabase().prepare(`SELECT conversation_id, agent_id
    FROM sessions WHERE ${column} = ? AND json_extract(custom_data_json, '$.personalAgent') = 1
    ORDER BY created_at LIMIT 1`).get(value) as PersonalSession | undefined;
  return row ?? null;
}

function appearanceFrom(agent: StoredAgent): PersonalAppearance {
  return agent.profile?.emoji === '☁' ? 'cloud' : agent.profile?.emoji === '◕' ? 'bean' : 'spark';
}

function toRecord(ownerId: string, agent: StoredAgent, session: PersonalSession | null): PersonalAgentRecord {
  const config = session ? getSessionConfig(session.conversation_id) : null;
  const ready = agent.provisioningState === 'ready' && agent.runtime?.thinkingLevel === 'off'
    && session && config?.thinkingLevel === 'off' && config.fixedModel;
  return {
    ownerId,
    agentId: agent.id,
    conversationId: session?.conversation_id ?? personalConversationId(ownerId),
    state: agent.provisioningState === 'error' ? 'error' : ready ? 'ready' : 'provisioning',
    displayName: agent.profile?.name ?? 'Personal AI',
    appearance: appearanceFrom(agent),
    preferences: agent.profile?.responsePreferences ?? DEFAULT_PERSONAL_PREFERENCES,
    revision: agent.revision,
    errorMessage: agent.provisioningError ?? null,
  };
}

export function getPersonalAgent(ownerId: string): PersonalAgentRecord | null {
  if (!isXopcDatabaseOpen()) return null;
  const agent = new AgentCatalogRepository().get(personalAgentId(ownerId));
  return agent ? toRecord(ownerId, agent, personalSession('agent_id', agent.id)) : null;
}

export function getPersonalAgentByConversation(conversationId: string): PersonalAgentRecord | null {
  const session = personalSession('conversation_id', conversationId);
  if (!session) return null;
  const agent = new AgentCatalogRepository().get(session.agent_id);
  if (!agent) return null;
  const ownerId = 'local-owner';
  return agent.id === personalAgentId(ownerId) ? toRecord(ownerId, agent, session) : null;
}

export function isPersonalConversation(conversationId: string): boolean {
  if (!isXopcDatabaseOpen()) return false;
  return Boolean(getSqliteDatabase().prepare(`SELECT 1 FROM sessions WHERE conversation_id = ?
    AND agent_id = ? AND json_extract(custom_data_json, '$.personalAgent') = 1`)
    .get(conversationId, personalAgentId('local-owner')));
}
