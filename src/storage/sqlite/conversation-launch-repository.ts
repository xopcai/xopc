import type { ConversationLaunchView, ConversationOrigin } from '@xopcai/gateway-contract';

import { getSessionPreparation } from './session-creation-repository.js';
import { getSessionInputById } from './session-input-repository.js';
import { getSessionMetadata } from './session-repository.js';
import { getSqliteDatabase } from './transaction.js';

export interface ConversationLaunch {
  id: string;
  principalId: string;
  sourceConversationId: string;
  sourceTranscriptId: string;
  sourceAgentId: string;
  sourceRunId: string | null;
  sourceToolCallId: string;
  targetConversationId: string;
  targetTranscriptId: string;
  targetInputId: string;
  idempotencyKey: string;
  requestHash: string;
  title: string;
  projectId: string | null;
  createdAt: number;
}

const columns = `id, principal_id AS principalId, source_conversation_id AS sourceConversationId,
  source_transcript_id AS sourceTranscriptId, source_run_id AS sourceRunId, source_agent_id AS sourceAgentId, source_tool_call_id AS sourceToolCallId,
  target_conversation_id AS targetConversationId, target_transcript_id AS targetTranscriptId,
  target_input_id AS targetInputId, idempotency_key AS idempotencyKey, request_hash AS requestHash,
  title, project_id AS projectId, created_at AS createdAt`;

export function findConversationLaunch(principalId: string, sourceId: string, key: string): ConversationLaunch | undefined {
  return getSqliteDatabase().prepare(`SELECT ${columns} FROM conversation_launches
    WHERE principal_id=? AND source_conversation_id=? AND idempotency_key=?`)
    .get(principalId, sourceId, key) as unknown as ConversationLaunch | undefined;
}

export function insertConversationLaunch(launch: ConversationLaunch): void {
  getSqliteDatabase().prepare(`INSERT INTO conversation_launches
    (id,principal_id,source_conversation_id,source_transcript_id,source_run_id,source_agent_id,source_tool_call_id,
     target_conversation_id,target_transcript_id,target_input_id,idempotency_key,request_hash,title,project_id,created_at)
    VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`).run(launch.id, launch.principalId, launch.sourceConversationId,
      launch.sourceTranscriptId, launch.sourceRunId, launch.sourceAgentId, launch.sourceToolCallId, launch.targetConversationId,
      launch.targetTranscriptId, launch.targetInputId, launch.idempotencyKey, launch.requestHash,
      launch.title, launch.projectId, launch.createdAt);
}

/** No cascading foreign keys: deleting either conversation must not erase provenance or replay identity. */
export function conversationOriginForInput(inputId: string): ConversationOrigin | undefined {
  const launch = getSqliteDatabase().prepare(`SELECT id AS launchId, source_conversation_id AS conversationId,
    source_agent_id AS agentId FROM conversation_launches WHERE target_input_id=?`).get(inputId);
  return launch as ConversationOrigin | undefined;
}

export function listConversationLaunches(sourceId: string, targetIds: string[]): ConversationLaunchView[] {
  if (!targetIds.length) return [];
  const placeholders = targetIds.map(() => '?').join(',');
  const rows = getSqliteDatabase().prepare(`SELECT ${columns} FROM conversation_launches
    WHERE source_conversation_id=? AND target_conversation_id IN (${placeholders})`)
    .all(sourceId, ...targetIds) as unknown as ConversationLaunch[];
  return rows.map(conversationLaunchView);
}

export function conversationLaunchView(launch: ConversationLaunch): ConversationLaunchView {
  const session = getSessionMetadata(launch.targetConversationId);
  const input = getSessionInputById(launch.targetConversationId, launch.targetInputId);
  const preparation = getSessionPreparation(launch.targetConversationId);
  const status: ConversationLaunchView['status'] = !session ? 'unavailable'
    : preparation?.state === 'preparing' || preparation?.state === 'preparation_failed' ? preparation.state
    : !input ? 'unavailable'
    : input.status === 'suspended' ? 'waiting'
    : input.status === 'injecting' || input.status === 'interrupted' ? 'running' : input.status;
  let summary: string | undefined;
  if (session && input?.runId) {
    const rows = getSqliteDatabase().prepare(`SELECT payload_json FROM transcript_entries
      WHERE transcript_id=? AND role='assistant' AND json_extract(payload_json,'$.turnId')=?
      ORDER BY seq DESC LIMIT 1`).all(launch.targetTranscriptId, input.runId) as Array<{ payload_json: string }>;
    const message = rows[0] ? JSON.parse(rows[0].payload_json) as { content?: unknown } : undefined;
    const content = message?.content;
    const text = typeof content === 'string' ? content : Array.isArray(content)
      ? content.flatMap((block: { type?: string; text?: string }) => block.type === 'text' && typeof block.text === 'string' ? [block.text] : []).join('\n') : '';
    summary = text.trim().slice(0, 240) || undefined;
  }
  return { launchId: launch.id, conversationId: launch.targetConversationId, inputId: launch.targetInputId,
    title: session?.name || launch.title, ...(launch.projectId ? { projectId: launch.projectId } : {}), status,
    ...(summary ? { summary } : {}) };
}
