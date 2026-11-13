import {
  parseFileResourceArtifactUri, parseProductDeliveryEnvelope, parseTaskResultDelivery, parseTurnOutcome, TASK_RESULT_DELIVERY_TYPE,
  type PersonalDeliverable, type PersonalDeliverablesPage, type TurnOutcomeDeliverable,
} from '@xopcai/gateway-contract';

import { getSqliteDatabase } from '../storage/sqlite/transaction.js';

const transcriptDeliverable = `(
  (json_extract(e.payload_json, '$.type') = 'custom' AND json_extract(e.payload_json, '$.customType') = 'turn_outcome'
    AND json_array_length(e.payload_json, '$.data.deliverables') > 0)
  OR (e.role = 'custom' AND json_extract(e.payload_json, '$.customType') = '${TASK_RESULT_DELIVERY_TYPE}'
    AND json_array_length(e.payload_json, '$.details.outcome.deliverables') > 0)
  OR (e.role = 'assistant' AND json_array_length(e.payload_json, '$.metadata.turnOutcome.deliverables') > 0
    AND COALESCE(json_extract(e.payload_json, '$.metadata.hiddenFromClient'), 0) = 0
    AND COALESCE(json_extract(e.payload_json, '$.metadata.voiceConversation'), 0) = 0)
  OR (e.role IN ('toolResult', 'tool') AND json_extract(e.payload_json, '$.details.delivery.primary.kind')
    IN ('note', 'chat_preview', 'local_app') AND json_extract(e.payload_json, '$.details.delivery.operation') IN ('created', 'updated'))
)`;

type DeliverableRow = {
  id: string;
  created_at: number;
  payload_json: string;
  kind: 'outcome' | 'delivery' | 'transcript' | 'music' | 'video';
  task_id: string | null;
  task_title: string | null;
  conversation_id: string | null;
};

export function isAvailableDeliverable(item: TurnOutcomeDeliverable, now: number): boolean {
  return item.availability === 'available' && Boolean(item.uri || item.shareUrl || item.workspaceRelativePath)
    && (!item.expiresAt || Date.parse(item.expiresAt) > now);
}

function generatedMediaDeliverable(row: DeliverableRow): PersonalDeliverable | undefined {
  if ((row.kind !== 'music' && row.kind !== 'video') || !row.conversation_id) return;
  const music = row.kind === 'music';
  const uri = `/api/${row.kind}-generation/sessions/${encodeURIComponent(row.conversation_id)}/jobs/${encodeURIComponent(row.id)}/${music ? 'audio' : 'video'}`;
  return {
    id: uri,
    turnId: `${row.kind}-generation:${row.id}`,
    createdAt: row.created_at,
    artifact: {
      artifactId: row.id,
      title: JSON.parse(row.payload_json).title,
      kind: music ? 'audio' : 'video',
      mimeType: music ? 'audio/mpeg' : 'video/mp4',
      availability: 'available',
      location: 'artifact_store',
      capabilities: ['preview', 'download'],
      uri,
    },
  };
}

export function listDeliverables(scope: { conversationId: string } | { taskId: string }, limit: number, offset = 0): PersonalDeliverablesPage {
  const personal = 'conversationId' in scope;
  const rows = getSqliteDatabase().prepare(`WITH selected_tasks AS (
      SELECT t.task_id, t.title FROM tasks t
      ${personal ? 'JOIN task_origin_links origin USING (task_id) WHERE origin.conversation_id = ?' : 'WHERE t.task_id = ?'}
    ), task_conversations AS (
      SELECT t.task_id, t.title, s.conversation_id FROM selected_tasks t
      JOIN task_sessions s ON s.task_id = t.task_id WHERE s.role IN ('primary', 'execution') AND s.conversation_id IS NOT NULL
      UNION
      SELECT t.task_id, t.title, r.conversation_id FROM selected_tasks t
      JOIN task_runs r ON r.task_id = t.task_id WHERE r.conversation_id IS NOT NULL
    )${personal ? `, personal_session AS (
      SELECT conversation_id, active_transcript_id FROM sessions WHERE conversation_id = ?
    )` : ''}, candidates AS (
      SELECT o.outcome_id AS id, o.rowid AS position, o.created_at, o.outcome_json AS payload_json, 'outcome' AS kind, t.task_id, t.title AS task_title, r.conversation_id
        FROM selected_tasks t JOIN task_runs r ON r.task_id = t.task_id JOIN task_run_outcomes o ON o.task_run_id = r.run_id
        WHERE json_array_length(o.outcome_json, '$.deliverables') > 0
      UNION ALL
      SELECT d.delivery_id, d.rowid, COALESCE(d.delivered_at, d.created_at), d.payload_json, 'delivery', t.task_id, t.title, r.conversation_id
        FROM selected_tasks t JOIN task_runs r ON r.task_id = t.task_id JOIN task_result_deliveries d ON d.task_run_id = r.run_id
        WHERE d.status IN ('pending', 'delivered') AND json_array_length(d.payload_json, '$.outcome.deliverables') > 0
      UNION ALL
      SELECT e.entry_id, e.seq, e.created_at, e.payload_json, 'transcript', t.task_id, t.title, t.conversation_id
        FROM task_conversations t JOIN transcripts tr ON tr.conversation_id = t.conversation_id
        JOIN transcript_entries e ON e.transcript_id = tr.transcript_id
        WHERE (tr.status = 'active' OR tr.archive_reason IN ('reset', 'stale'))
          AND NOT EXISTS (SELECT 1 FROM task_origin_links origin
            WHERE origin.task_id = t.task_id AND origin.conversation_id = t.conversation_id)
          AND ${transcriptDeliverable}
      ${personal ? `UNION ALL
      SELECT e.entry_id, e.seq, e.created_at, e.payload_json, 'transcript', NULL, NULL, NULL
        FROM personal_session s JOIN transcript_entries e ON e.transcript_id = s.active_transcript_id
        WHERE ${transcriptDeliverable}
      UNION ALL
      SELECT j.id, j.rowid, j.created_at, json_object('title', j.title), 'music', NULL, NULL, j.conversation_id
        FROM personal_session s JOIN music_generation_jobs j USING (conversation_id)
        WHERE j.transcript_id = s.active_transcript_id AND j.state = 'completed'
      UNION ALL
      SELECT j.id, j.rowid, j.created_at, json_object('title', substr(j.prompt, 1, 100)), 'video', NULL, NULL, j.conversation_id
        FROM personal_session s JOIN video_generation_jobs j USING (conversation_id)
        WHERE j.transcript_id = s.active_transcript_id AND j.state = 'completed'` : ''}
    )
    SELECT * FROM candidates ORDER BY created_at DESC, task_id IS NULL, kind <> 'delivery', position DESC, id DESC`)
    .iterate(...(personal ? [scope.conversationId, scope.conversationId] : [scope.taskId])) as Iterable<DeliverableRow>;

  const now = Date.now();
  const seen = new Set<string>();
  const items: PersonalDeliverable[] = [];
  for (const row of rows) {
    const generated = generatedMediaDeliverable(row);
    const candidates = generated ? [generated] : publishedDeliverables(row, now);
    for (const item of candidates) {
      if (seen.has(item.id)) continue;
      seen.add(item.id);
      if (seen.size <= offset) continue;
      if (items.length === limit) return { items, nextOffset: offset + limit };
      items.push(item);
    }
  }
  return { items, nextOffset: null };
}

function publishedDeliverables(row: DeliverableRow, now: number): PersonalDeliverable[] {
  const entry = JSON.parse(row.payload_json);
  const delivery = parseTaskResultDelivery(row.kind === 'delivery' ? entry : entry.details);
  const outcome = parseTurnOutcome(row.kind === 'outcome' ? entry : delivery?.outcome ?? entry.data ?? entry.metadata?.turnOutcome);
  const turnId = delivery ? `task-result:${delivery.deliveryId}` : outcome?.turnId ?? entry.turnId;
  if (typeof turnId !== 'string' || !turnId) return [];
  const task = row.task_id && row.task_title
    ? { id: row.task_id, title: row.task_title, conversationId: row.conversation_id ?? undefined }
    : delivery ? { id: delivery.taskId, title: delivery.taskTitle } : undefined;
  const base = { turnId, createdAt: row.created_at, task };
  const candidates: PersonalDeliverable[] = [];
  for (const artifact of outcome?.deliverables ?? []) {
    if (!isAvailableDeliverable(artifact, now)) continue;
    const sourceFileId = artifact.sourceFileId ?? parseFileResourceArtifactUri(artifact.uri ?? '');
    const id = sourceFileId ? `source:${sourceFileId}` : artifact.uri ?? artifact.shareUrl ?? artifact.artifactId;
    candidates.push({ ...base, id, artifact });
  }
  const reference = parseProductDeliveryEnvelope(entry.details?.delivery)?.primary;
  if (reference && (reference.kind === 'note' || reference.kind === 'local_app'
    || reference.kind === 'chat_preview' && reference.revision)) {
    candidates.push({ ...base, id: `product:${reference.kind}:${reference.id}`, reference });
  }
  return candidates;
}
