import {
  ProactiveSubscriptionCreateSchema, ProactiveSubscriptionSettingsSchema, ProactiveSubscriptionUpdateSchema,
} from '@xopcai/gateway-contract';

import { getSqliteDatabase, runSqliteWriteTransaction } from '../../storage/sqlite/transaction.js';
import { ProactiveConflict, subscriptionSettings } from '../policy/service.js';
import { getScenario, getSubscription, listSubscriptions, createPromptDraft, publishPromptRevision, upsertSubscription } from './repository.js';

export function requireSubscription(id: string, workspaceId: string) {
  const sub = getSubscription(id);
  if (!sub || sub.workspaceId !== workspaceId) throw new Error('Subscription not found');
  return sub;
}

export function controlledSubscriptions(workspaceId: string) {
  return listSubscriptions().filter((sub) => sub.workspaceId === workspaceId).map((sub) => ({
    ...sub, ...subscriptionSettings(sub.id),
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
  if (!getScenario(input.scenarioKey)) throw new Error('Scenario not found');
  const scopeKind = ['project_delivery_risk', 'blocked_work'].includes(input.scenarioKey) ? 'project' : 'workspace';
  if (input.scopeKind !== scopeKind) throw new Error('Invalid scenario scope');
  if (input.scopeKind === 'project' && !getSqliteDatabase().prepare('SELECT 1 FROM projects WHERE project_id = ?').get(input.scopeId)) throw new Error('Project not found');
  const scopeId = input.scopeKind === 'workspace' ? workspaceId : input.scopeId;
  return runSqliteWriteTransaction(() => {
    const existing = listSubscriptions(input.scenarioKey).find((sub) => sub.workspaceId === workspaceId && sub.scopeKind === input.scopeKind && sub.scopeId === scopeId);
    if (existing) throw new ProactiveConflict('Subscription already exists');
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
