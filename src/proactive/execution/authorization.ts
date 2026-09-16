import { sourceFreshness } from '../source-freshness.js';
import { readMailThread } from '../mail-thread.js';
import { getConnectorSyncPolicyForConnection } from '../../storage/sqlite/connector-sync-policy-repository.js';
import { getKnowledgeSourceItem } from '../../storage/sqlite/knowledge-repository.js';
import { getSqliteDatabase } from '../../storage/sqlite/transaction.js';

/** Recheck connector consent for stored cards and actions, not just model input. */
export function insightSourcesAuthorized(insightId: string): boolean {
  const snapshot = getSqliteDatabase().prepare(`SELECT s.workspace_id, x.scenario_key, c.evidence_ids_json
    FROM proactive_insights x JOIN proactive_scenario_subscriptions s USING(subscription_id)
    JOIN proactive_runs r USING(run_id) LEFT JOIN proactive_context_snapshots c ON c.snapshot_id = r.context_snapshot_id
    WHERE x.insight_id = ?`).get(insightId) as { workspace_id: string; scenario_key: string; evidence_ids_json: string | null } | undefined;
  if (snapshot?.evidence_ids_json) {
    const ids = JSON.parse(snapshot.evidence_ids_json) as string[];
    if (ids.some(id => id.startsWith('source-item:') && !authorizedConnectedSource(id.slice('source-item:'.length), snapshot.workspace_id, snapshot.scenario_key))) return false;
  }
  const rows = getSqliteDatabase().prepare(`SELECT e.subject_id, e.workspace_id, x.scenario_key
    FROM proactive_insights x JOIN proactive_runs r USING(run_id)
    JOIN proactive_batch_events be ON be.batch_id = r.batch_id JOIN proactive_events e USING(event_id)
    WHERE x.insight_id = ? AND e.type LIKE 'connected_source.%'`).all(insightId) as Array<{ subject_id: string; workspace_id: string; scenario_key: string }>;
  return rows.every((row) => Boolean(authorizedConnectedSource(row.subject_id, row.workspace_id, row.scenario_key)));
}

/** Compare versions, not generated prose, before showing or executing prepared work. */
export function insightSourcesChanged(insightId: string): boolean {
  const db = getSqliteDatabase();
  const row = db.prepare(`SELECT c.content_json FROM proactive_insights x JOIN proactive_runs r USING(run_id)
    JOIN proactive_context_snapshots c ON c.snapshot_id = r.context_snapshot_id WHERE x.insight_id = ?`).get(insightId) as { content_json: string } | undefined;
  if (!row) return false;
  const snapshot = JSON.parse(row.content_json) as {
    connected_source?: { items?: Array<{ sourceItemId: string; contentHash: string; occurredAt?: string }> };
    follow_up?: { followUpId?: string; revision?: number; fingerprint?: string; deadlinePassed?: boolean; items?: Array<{ sourceItemId: string; contentHash: string; occurredAt?: string }> };
    project_state?: { project?: { project_id: string; updated_at: number }; activeTasks?: Array<{ task_id: string; updated_at: number }> };
    meeting_workspace?: { activeTasks?: Array<{ task_id: string; updated_at: number }>; recentNotes?: Array<{ note_id: string; updated_at: number }> };
  };
  if (snapshot.follow_up?.followUpId) {
    const follow = db.prepare('SELECT source_item_id, revision, status, due_at FROM proactive_follow_ups WHERE id = ?').get(snapshot.follow_up.followUpId) as { source_item_id: string; revision: number; status: string; due_at: string } | undefined;
    if (!follow || follow.status !== 'watching' || follow.revision !== snapshot.follow_up.revision
      || (Date.parse(follow.due_at) <= Date.now()) !== snapshot.follow_up.deadlinePassed
      || readMailThread(follow.source_item_id)?.fingerprint !== snapshot.follow_up.fingerprint) return true;
  }
  for (const source of [...snapshot.connected_source?.items ?? [], ...snapshot.follow_up?.items ?? []]) {
    const current = getKnowledgeSourceItem(source.sourceItemId);
    if (!current || current.deletedAt || current.contentHash !== source.contentHash || current.occurredAt !== source.occurredAt) return true;
  }
  const project = snapshot.project_state?.project;
  if (project) {
    const current = db.prepare('SELECT updated_at FROM projects WHERE project_id = ?').get(project.project_id) as { updated_at: number } | undefined;
    if (!current || current.updated_at !== project.updated_at) return true;
  }
  for (const task of [...snapshot.project_state?.activeTasks ?? [], ...snapshot.meeting_workspace?.activeTasks ?? []]) {
    const current = db.prepare('SELECT updated_at FROM tasks WHERE task_id = ?').get(task.task_id) as { updated_at: number } | undefined;
    if (!current || current.updated_at !== task.updated_at) return true;
  }
  for (const note of snapshot.meeting_workspace?.recentNotes ?? []) {
    const current = db.prepare('SELECT updated_at FROM notes WHERE note_id = ?').get(note.note_id) as { updated_at: number } | undefined;
    if (!current || current.updated_at !== note.updated_at) return true;
  }
  return false;
}

export function authorizedConnectedSource(itemId: string, workspaceId: string, scenarioKey: string, agentId?: string | null) {
  const item = getKnowledgeSourceItem(itemId);
  if (!item || item.deletedAt || item.metadata.workspaceId !== workspaceId || item.sensitivity === 'secret' || item.sensitivity === 'regulated') return null;
  if (agentId && item.metadata.agentId && item.metadata.agentId !== agentId) return null;
  const connectionId = item.metadata.connectionId;
  if (typeof connectionId !== 'string') return null;
  if (!getSqliteDatabase().prepare("SELECT 1 FROM connector_connections WHERE id = ? AND status = 'active'").get(connectionId)) return null;
  const policy = getConnectorSyncPolicyForConnection(connectionId);
  return policy?.scanEnabled && policy.proactiveEnabled && (!policy.allowedScenarioKeys.length || policy.allowedScenarioKeys.includes(scenarioKey)) ? item : null;
}

/** Delivery eligibility is stricter than reading historical artifacts. */
export function insightSourcesFresh(insightId: string): boolean {
  const db = getSqliteDatabase();
  const row = db.prepare(`SELECT c.evidence_ids_json, c.content_json FROM proactive_insights x JOIN proactive_runs r USING(run_id)
    JOIN proactive_context_snapshots c ON c.snapshot_id = r.context_snapshot_id WHERE x.insight_id = ?`).get(insightId) as { evidence_ids_json: string; content_json: string } | undefined;
  if (!row) return true;
  const follow = (JSON.parse(row.content_json) as { follow_up?: { dueAt?: string; deadlinePassed?: boolean } }).follow_up;
  return (JSON.parse(row.evidence_ids_json) as string[]).every(id => !id.startsWith('source-item:')
    || sourceFreshness(id.slice(12), follow?.deadlinePassed ? follow.dueAt : undefined).fresh);
}
