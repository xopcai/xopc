import { createHash } from 'node:crypto';
import type { VoiceCallPreferences } from '@xopcai/realtime-protocol/voice';

import { AgentCatalogRepository } from '../agent-catalog/repository.js';
import type { StoredAgent } from '../agent-catalog/types.js';
import type { Config } from '../config/schema.js';
import { isXopcDatabaseOpen } from '../storage/sqlite/connection.js';
import { getSessionConfig } from '../storage/sqlite/config-repository.js';
import { getSqliteDatabase } from '../storage/sqlite/transaction.js';
import { getUserProfileSnapshot } from '../user-model/profile.js';

export type PersonalAgentState = 'provisioning' | 'ready' | 'error';
export type PersonalAppearance = 'loopi' | 'loopi-curious' | 'loopi-care' | 'custom';

export interface PersonalAgentRecord {
  ownerId: string;
  agentId: string;
  conversationId: string;
  transcriptId?: string;
  state: PersonalAgentState;
  displayName: string;
  userCallName: string | null;
  appearance: PersonalAppearance;
  voicePreference: { provider: string; model: string; voice: string } | null;
  voiceCallPreferences: VoiceCallPreferences;
  messageReactionsEnabled?: boolean;
  revision: number;
  errorMessage: string | null;
}

export function personalAgentId(ownerId: string): string {
  return `personal-${createHash('sha256').update(ownerId).digest('hex').slice(0, 12)}`;
}

export function personalConversationId(ownerId: string): string {
  const hash = createHash('sha256').update(`personal-conversation:${ownerId}`).digest('hex');
  return `${hash.slice(0, 8)}-${hash.slice(8, 12)}-5${hash.slice(13, 16)}-8${hash.slice(17, 20)}-${hash.slice(20, 32)}`;
}

export function resolveMessageReactionsEnabled(preference: boolean | undefined, config: Config | undefined): boolean {
  return preference ?? (config?.experimental?.personalAgentMessageReactions === true);
}

type PersonalSession = { conversation_id: string; agent_id: string; active_transcript_id: string | null; custom_data_json: string | null };

function personalSession(column: 'agent_id' | 'conversation_id', value: string): PersonalSession | null {
  if (!isXopcDatabaseOpen()) return null;
  const row = getSqliteDatabase().prepare(`SELECT conversation_id, agent_id, active_transcript_id, custom_data_json
    FROM sessions WHERE ${column} = ? AND json_extract(custom_data_json, '$.personalAgent') = 1
    ORDER BY created_at LIMIT 1`).get(value) as PersonalSession | undefined;
  return row ?? null;
}

function appearanceFrom(agent: StoredAgent): PersonalAppearance {
  const avatar = agent.profile?.avatar;
  if (avatar === 'xopc:custom') return 'custom';
  if (avatar === 'xopc:loopi:curious' || avatar === 'xopc:loopi:listen' || (!avatar && agent.profile?.emoji === '☁')) return 'loopi-curious';
  if (avatar === 'xopc:loopi:care' || (!avatar && agent.profile?.emoji === '◕')) return 'loopi-care';
  return 'loopi';
}

function toRecord(ownerId: string, agent: StoredAgent, session: PersonalSession | null): PersonalAgentRecord {
  const config = session ? getSessionConfig(session.conversation_id) : null;
  const ready = agent.provisioningState === 'ready' && session && config?.fixedModel;
  return {
    ownerId,
    agentId: agent.id,
    conversationId: session?.conversation_id ?? personalConversationId(ownerId),
    ...(session?.active_transcript_id ? { transcriptId: session.active_transcript_id } : {}),
    state: agent.provisioningState === 'error' ? 'error' : ready ? 'ready' : 'provisioning',
    displayName: agent.profile?.name ?? 'Ada',
    userCallName: getUserProfileSnapshot().callName ?? null,
    appearance: appearanceFrom(agent),
    voicePreference: agent.profile?.voicePreference ?? null,
    voiceCallPreferences: agent.profile?.voiceCallPreferences ?? { openingGreetingEnabled: true },
    messageReactionsEnabled: agent.profile?.messageReactionsEnabled,
    revision: agent.revision,
    errorMessage: agent.provisioningError ?? null,
  };
}

export const DEFAULT_PERSONAL_OWNER_ID = 'local-owner';

export function resolvePersonalOwnerId(explicitOwnerId?: string): string {
  if (typeof explicitOwnerId === 'string' && explicitOwnerId.trim()) {
    return explicitOwnerId.trim();
  }
  if (!isXopcDatabaseOpen()) {
    return DEFAULT_PERSONAL_OWNER_ID;
  }
  const db = getSqliteDatabase();
  const session = db.prepare(`
    SELECT custom_data_json
    FROM sessions
    WHERE json_extract(custom_data_json, '$.personalAgent') = 1
    ORDER BY created_at ASC
    LIMIT 1
  `).get() as { custom_data_json: string | null } | undefined;
  if (session?.custom_data_json) {
    try {
      const parsed = JSON.parse(session.custom_data_json) as { ownerId?: unknown };
      if (typeof parsed.ownerId === 'string' && parsed.ownerId.trim()) {
        return parsed.ownerId.trim();
      }
    } catch {
      // Ignore malformed session custom_data_json and continue fallback lookup.
    }
  }
  const threadOwner = db.prepare(`
    SELECT owner_id FROM personal_attention_threads ORDER BY updated_at DESC LIMIT 1
  `).get() as { owner_id?: string } | undefined;
  if (threadOwner?.owner_id?.trim()) {
    return threadOwner.owner_id.trim();
  }
  return DEFAULT_PERSONAL_OWNER_ID;
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
  let ownerId = DEFAULT_PERSONAL_OWNER_ID;
  if (session.custom_data_json) {
    try {
      const parsed = JSON.parse(session.custom_data_json) as { ownerId?: unknown };
      if (typeof parsed.ownerId === 'string' && parsed.ownerId.trim()) ownerId = parsed.ownerId.trim();
    } catch { /* ignore invalid custom_data_json */ }
  }
  return agent.id === personalAgentId(ownerId) ? toRecord(ownerId, agent, session) : null;
}

export function isPersonalConversation(conversationId: string): boolean {
  if (!isXopcDatabaseOpen()) return false;
  const session = personalSession('conversation_id', conversationId);
  if (!session) return false;
  let ownerId = DEFAULT_PERSONAL_OWNER_ID;
  if (session.custom_data_json) {
    try {
      const parsed = JSON.parse(session.custom_data_json) as { ownerId?: unknown };
      if (typeof parsed.ownerId === 'string' && parsed.ownerId.trim()) ownerId = parsed.ownerId.trim();
    } catch { /* ignore invalid custom_data_json */ }
  }
  return session.agent_id === personalAgentId(ownerId);
}

export function isPersonalDelegatedTask(taskId: string): boolean {
  if (!isXopcDatabaseOpen()) return false;
  const origin = getSqliteDatabase().prepare('SELECT conversation_id FROM task_origin_links WHERE task_id = ?')
    .get(taskId)?.conversation_id;
  return typeof origin === 'string' && isPersonalConversation(origin);
}
