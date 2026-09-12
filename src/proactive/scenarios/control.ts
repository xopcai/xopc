import {
  ProactiveSubscriptionCreateSchema, ProactiveSubscriptionSettingsSchema, ProactiveSubscriptionUpdateSchema,
} from '@xopcai/gateway-contract';

import { getSqliteDatabase, runSqliteWriteTransaction } from '../../storage/sqlite/transaction.js';
import { effectiveProactivePolicy, ProactiveConflict, subscriptionSettings } from '../policy/service.js';
import { getScenario, getSubscription, listScenarios, listSubscriptions, createPromptDraft, publishPromptRevision, upsertSubscription } from './repository.js';

export function requireSubscription(id: string, workspaceId: string) {
  const sub = getSubscription(id);
  if (!sub || sub.workspaceId !== workspaceId) throw new Error('Subscription not found');
  return sub;
}

export function templateCatalog(workspaceId?: string) {
  return listScenarios().map((scenario) => ({
    key: scenario.key, version: scenario.version, title: scenario.title, description: scenario.description,
    scopeKind: ['project_delivery_risk', 'blocked_work'].includes(scenario.key) ? 'project' as const : 'workspace' as const,
    eventTypes: scenario.eventTypes, contextProviderIds: scenario.contextProviderIds,
    scheduled: ['project_delivery_risk', 'blocked_work', 'meeting_preparation'].includes(scenario.key),
    requiresCalendar: scenario.key === 'meeting_preparation',
    ...(workspaceId && scenario.key === 'meeting_preparation' ? { calendarSource: calendarSourceStatus(workspaceId) } : {}),
    parameterSchema: { type: 'object', properties: { scanIntervalMinutes: { type: 'integer', minimum: 15, maximum: 10080 }, userInstructions: { type: 'string', maxLength: 12000 } } },
  }));
}

export function controlledSubscriptions(workspaceId: string) {
  return listSubscriptions().filter((sub) => sub.workspaceId === workspaceId).map((sub) => ({
    ...sub, ...subscriptionSettings(sub.id), effectiveLevel: effectiveProactivePolicy(sub.id).level,
    schedule: getSqliteDatabase().prepare('SELECT next_due_at AS nextDueAt, last_checked_at AS lastCheckedAt FROM proactive_schedule_state WHERE subscription_id = ?').get(sub.id) ?? null,
  }));
}

function saveSettings(id: string, value: unknown, revision: number) {
  const settings = ProactiveSubscriptionSettingsSchema.parse(value);
  getSqliteDatabase().prepare(`INSERT INTO proactive_subscription_settings(subscription_id, settings_json, revision) VALUES (?, ?, ?)
    ON CONFLICT(subscription_id) DO UPDATE SET settings_json = excluded.settings_json, revision = excluded.revision`).run(id, JSON.stringify(settings), revision);
  getSqliteDatabase().prepare(`INSERT INTO proactive_schedule_state(subscription_id, next_due_at) VALUES (?, ?)
    ON CONFLICT(subscription_id) DO UPDATE SET next_due_at = excluded.next_due_at`).run(id, new Date().toISOString());
}

export function createControlledSubscription(workspaceId: string, value: unknown) {
  const input = ProactiveSubscriptionCreateSchema.parse(value);
  const template = templateCatalog().find((item) => item.key === input.scenarioKey);
  if (!template || !getScenario(input.scenarioKey)) throw new Error('Template not found');
  if (input.scopeKind !== template.scopeKind) throw new Error('Invalid template scope');
  if (input.scopeKind === 'project' && !getSqliteDatabase().prepare('SELECT 1 FROM projects WHERE project_id = ?').get(input.scopeId)) throw new Error('Project not found');
  const scopeId = input.scopeKind === 'workspace' ? workspaceId : input.scopeId;
  return runSqliteWriteTransaction(() => {
    const existing = listSubscriptions(input.scenarioKey).find((sub) => sub.workspaceId === workspaceId && sub.scopeKind === input.scopeKind && sub.scopeId === scopeId);
    if (existing && subscriptionSettings(existing.id).managed) throw new ProactiveConflict('Subscription already exists');
    const sub = upsertSubscription({ ...input, scopeId, workspaceId });
    if (input.userInstructions || sub.activePromptRevisionId) publishPromptRevision(createPromptDraft(sub.id, input.userInstructions).id);
    saveSettings(sub.id, input, 1);
    return controlledSubscriptions(workspaceId).find((item) => item.id === sub.id)!;
  });
}

export function updateControlledSubscription(workspaceId: string, id: string, value: unknown) {
  const { expectedRevision, ...patch } = ProactiveSubscriptionUpdateSchema.parse(value);
  return runSqliteWriteTransaction(() => {
    const sub = requireSubscription(id, workspaceId);
    const current = subscriptionSettings(id);
    if (current.revision !== expectedRevision) throw new ProactiveConflict('Subscription changed; refresh and try again');
    upsertSubscription({ ...sub, enabled: patch.enabled ?? sub.enabled });
    if (patch.userInstructions !== undefined && patch.userInstructions !== current.userInstructions) {
      publishPromptRevision(createPromptDraft(id, patch.userInstructions).id);
    }
    saveSettings(id, { ...current, ...patch }, current.revision + 1);
    return controlledSubscriptions(workspaceId).find((item) => item.id === id)!;
  });
}

function calendarSourceStatus(workspaceId: string) {
  const row = getSqliteDatabase().prepare(`SELECT COUNT(*) AS count, MAX(k.updated_at) AS lastSyncedAt FROM knowledge_source_items k
    JOIN connector_connections c ON c.id = json_extract(k.metadata_json, '$.connectionId')
    JOIN connector_sync_policies p ON p.account_id = c.account_id
    WHERE k.item_type = 'calendar_event' AND k.deleted_at IS NULL AND k.sensitivity NOT IN ('secret', 'regulated')
    AND json_extract(k.metadata_json, '$.workspaceId') = ? AND c.status = 'active' AND p.scan_enabled = 1 AND p.proactive_enabled = 1
    AND (json_array_length(p.allowed_scenario_keys_json) = 0 OR EXISTS (SELECT 1 FROM json_each(p.allowed_scenario_keys_json) WHERE value = 'meeting_preparation'))`)
    .get(workspaceId) as { count: number; lastSyncedAt: number | null };
  return { status: row.count ? 'available' : 'waiting_for_authorized_data', lastSyncedAt: row.lastSyncedAt ? new Date(row.lastSyncedAt).toISOString() : null };
}
