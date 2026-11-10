import type { AgentMessage } from '@earendil-works/pi-agent-core';

import { VOICE_TRANSCRIPT_TYPE, voiceTranscriptMessage } from '../session/voice-transcript.js';

/** Logical speaker selection without changing append-only stored voice rows. */
export function learningRoleSql(role: 'user' | 'assistant', alias = ''): string {
  if (alias && !/^[a-z_]+$/u.test(alias)) throw new Error('Invalid transcript alias');
  const prefix = alias ? `${alias}.` : '';
  return `(${prefix}role = '${role}' OR (${prefix}role = 'custom'
    AND json_extract(${prefix}payload_json, '$.customType') = '${VOICE_TRANSCRIPT_TYPE}'
    AND json_extract(${prefix}payload_json, '$.details.role') = '${role}'))`;
}

export function learningTranscriptMessage(row: { role: string | null; payload_json: string }): AgentMessage | undefined {
  const stored = JSON.parse(row.payload_json) as Record<string, unknown> | null;
  if (!stored || typeof stored !== 'object' || Array.isArray(stored)) return;
  if (row.role === null && stored.type === 'custom' && stored.customType === 'codemode-tool-result') {
    const data = stored.data as Record<string, unknown> | undefined;
    if (data && typeof data.toolName === 'string' && typeof data.toolCallId === 'string' && Array.isArray(data.content)) {
      return { ...data, role: 'toolResult' } as AgentMessage;
    }
  }
  if (row.role === 'custom' && stored.customType === VOICE_TRANSCRIPT_TYPE) return voiceTranscriptMessage(stored) ?? undefined;
  return ['user', 'assistant', 'toolResult'].includes(row.role ?? '') ? stored as AgentMessage : undefined;
}

/** Match the canonical routing fallback used by resolveUserContextSessionAccess. */
export const OWNER_LEARNING_SESSION_SQL = `(json_extract(s.routing_json, '$.peerKind') IS NOT NULL OR s.session_type = 'chat')
  AND COALESCE(json_extract(s.routing_json, '$.peerKind'), 'direct') = 'direct'
  AND (COALESCE(json_extract(s.routing_json, '$.source'), s.source_channel) IN ('webchat','cli','tui') OR EXISTS (
    SELECT 1 FROM owner_identity_bindings b WHERE b.revoked_at IS NULL
    AND b.channel = COALESCE(json_extract(s.routing_json, '$.source'), s.source_channel)
    AND b.account_id = COALESCE(json_extract(s.routing_json, '$.accountId'), 'default')
    AND b.peer_id = COALESCE(json_extract(s.routing_json, '$.peerId'), s.source_chat_id)))`;
