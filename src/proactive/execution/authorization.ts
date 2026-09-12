import { getConnectorSyncPolicyForConnection } from '../../storage/sqlite/connector-sync-policy-repository.js';
import { getKnowledgeSourceItem } from '../../storage/sqlite/knowledge-repository.js';
import { getSqliteDatabase } from '../../storage/sqlite/transaction.js';

/** Recheck connector consent for stored cards and actions, not just model input. */
export function insightSourcesAuthorized(insightId: string): boolean {
  const rows = getSqliteDatabase().prepare(`SELECT e.subject_id, e.workspace_id, x.scenario_key
    FROM proactive_insights x JOIN proactive_runs r USING(run_id)
    JOIN proactive_batch_events be ON be.batch_id = r.batch_id JOIN proactive_events e USING(event_id)
    WHERE x.insight_id = ? AND e.type LIKE 'connected_source.%'`).all(insightId) as Array<{ subject_id: string; workspace_id: string; scenario_key: string }>;
  return rows.every((row) => Boolean(authorizedConnectedSource(row.subject_id, row.workspace_id, row.scenario_key)));
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
