import { createHash, randomUUID } from 'node:crypto';

import { getSqliteDatabase, runSqliteWriteTransaction } from '../../storage/sqlite/transaction.js';

import type { EventCondition, ScenarioRoute } from '../routing/types.js';
import type { PromptRevision, ScenarioDefinition, ScenarioSubscription } from './types.js';

type Row = Record<string, unknown>;
const text = (row: Row, key: string) => String(row[key]);

function scenarioFromRow(row: Row): ScenarioDefinition {
  const condition = row.condition_json ? JSON.parse(String(row.condition_json)) as EventCondition : undefined;
  return {
    key: text(row, 'scenario_key'), version: Number(row.version), title: text(row, 'title'),
    description: text(row, 'description'), basePrompt: text(row, 'base_prompt'),
    baseTemplateVersion: Number(row.base_template_version),
    eventTypes: JSON.parse(text(row, 'event_types_json')) as string[],
    ...(condition ? { condition } : {}),
    aggregation: text(row, 'aggregation') as ScenarioDefinition['aggregation'],
    debounceSeconds: Number(row.debounce_seconds), maxWindowSeconds: Number(row.max_window_seconds),
  };
}

function subscriptionFromRow(row: Row): ScenarioSubscription {
  return {
    id: text(row, 'subscription_id'), scenarioKey: text(row, 'scenario_key'),
    workspaceId: text(row, 'workspace_id'), scopeKind: text(row, 'scope_kind') as 'workspace' | 'project',
    scopeId: text(row, 'scope_id'), enabled: Number(row.enabled) === 1,
    ...(row.active_prompt_revision_id ? { activePromptRevisionId: text(row, 'active_prompt_revision_id') } : {}),
    createdAt: text(row, 'created_at'), updatedAt: text(row, 'updated_at'),
  };
}

function revisionFromRow(row: Row): PromptRevision {
  return {
    id: text(row, 'revision_id'), subscriptionId: text(row, 'subscription_id'),
    revision: Number(row.revision), status: text(row, 'status') as PromptRevision['status'],
    baseTemplateVersion: Number(row.base_template_version), userInstructions: text(row, 'user_instructions'),
    contentHash: text(row, 'content_hash'), createdAt: text(row, 'created_at'),
    ...(row.published_at ? { publishedAt: text(row, 'published_at') } : {}),
  };
}

export function listScenarios(): ScenarioDefinition[] {
  return (getSqliteDatabase().prepare('SELECT * FROM proactive_scenarios ORDER BY scenario_key').all() as Row[]).map(scenarioFromRow);
}

export function getScenario(key: string): ScenarioDefinition | null {
  const row = getSqliteDatabase().prepare('SELECT * FROM proactive_scenarios WHERE scenario_key = ?').get(key) as Row | undefined;
  return row ? scenarioFromRow(row) : null;
}

export function upsertSubscription(input: {
  scenarioKey: string; workspaceId: string; scopeKind: 'workspace' | 'project'; scopeId: string; enabled: boolean;
}, now = new Date()): ScenarioSubscription {
  if (!getScenario(input.scenarioKey)) throw new Error('Scenario not found');
  const nowIso = now.toISOString();
  runSqliteWriteTransaction((db) => db.prepare(`INSERT INTO proactive_scenario_subscriptions (
    subscription_id, scenario_key, workspace_id, scope_kind, scope_id, enabled, created_at, updated_at
  ) VALUES (?, ?, ?, ?, ?, ?, ?, ?)
  ON CONFLICT(scenario_key, workspace_id, scope_kind, scope_id) DO UPDATE SET enabled = excluded.enabled, updated_at = excluded.updated_at`)
    .run(randomUUID(), input.scenarioKey, input.workspaceId, input.scopeKind, input.scopeId, input.enabled ? 1 : 0, nowIso, nowIso));
  const row = getSqliteDatabase().prepare(`SELECT * FROM proactive_scenario_subscriptions
    WHERE scenario_key = ? AND workspace_id = ? AND scope_kind = ? AND scope_id = ?`)
    .get(input.scenarioKey, input.workspaceId, input.scopeKind, input.scopeId) as Row;
  return subscriptionFromRow(row);
}

export function listSubscriptions(scenarioKey?: string): ScenarioSubscription[] {
  const rows = scenarioKey
    ? getSqliteDatabase().prepare('SELECT * FROM proactive_scenario_subscriptions WHERE scenario_key = ? ORDER BY updated_at DESC').all(scenarioKey)
    : getSqliteDatabase().prepare('SELECT * FROM proactive_scenario_subscriptions ORDER BY updated_at DESC').all();
  return (rows as Row[]).map(subscriptionFromRow);
}

export function listEnabledRoutes(): ScenarioRoute[] {
  return listSubscriptions().filter((item) => item.enabled).flatMap((subscription) => {
    const scenario = getScenario(subscription.scenarioKey);
    if (!scenario) return [];
    return [{
      subscriptionId: subscription.id,
      key: scenario.key, version: scenario.version, enabled: true, eventTypes: scenario.eventTypes,
      ...(scenario.condition ? { condition: scenario.condition } : {}), aggregation: scenario.aggregation,
      debounceSeconds: scenario.debounceSeconds, maxWindowSeconds: scenario.maxWindowSeconds,
      scope: {
        workspaceId: subscription.workspaceId,
        ...(subscription.scopeKind === 'project' ? { projectId: subscription.scopeId } : {}),
      },
    }];
  });
}

export function createPromptDraft(subscriptionId: string, userInstructions: string, now = new Date()): PromptRevision {
  const instructions = userInstructions.trim();
  if (instructions.length > 12_000) throw new Error('User instructions exceed 12000 characters');
  return runSqliteWriteTransaction((db) => {
    const subscription = db.prepare('SELECT * FROM proactive_scenario_subscriptions WHERE subscription_id = ?').get(subscriptionId) as Row | undefined;
    if (!subscription) throw new Error('Subscription not found');
    const scenario = db.prepare('SELECT * FROM proactive_scenarios WHERE scenario_key = ?').get(text(subscription, 'scenario_key')) as Row;
    const next = db.prepare('SELECT COALESCE(MAX(revision), 0) + 1 AS revision FROM proactive_prompt_revisions WHERE subscription_id = ?').get(subscriptionId) as { revision: number };
    const id = randomUUID();
    const baseTemplateVersion = Number(scenario.base_template_version);
    const hash = createHash('sha256').update(`${baseTemplateVersion}:${instructions}`).digest('hex');
    db.prepare(`INSERT INTO proactive_prompt_revisions
      (revision_id, subscription_id, revision, status, base_template_version, user_instructions, content_hash, created_at)
      VALUES (?, ?, ?, 'draft', ?, ?, ?, ?)`)
      .run(id, subscriptionId, next.revision, baseTemplateVersion, instructions, hash, now.toISOString());
    return revisionFromRow(db.prepare('SELECT * FROM proactive_prompt_revisions WHERE revision_id = ?').get(id) as Row);
  });
}

export function getPromptRevision(id: string): PromptRevision | null {
  const row = getSqliteDatabase().prepare('SELECT * FROM proactive_prompt_revisions WHERE revision_id = ?').get(id) as Row | undefined;
  return row ? revisionFromRow(row) : null;
}

export function getSubscription(id: string): ScenarioSubscription | null {
  const row = getSqliteDatabase().prepare('SELECT * FROM proactive_scenario_subscriptions WHERE subscription_id = ?').get(id) as Row | undefined;
  return row ? subscriptionFromRow(row) : null;
}

export function publishPromptRevision(id: string, now = new Date()): PromptRevision {
  return runSqliteWriteTransaction((db) => {
    const draft = db.prepare('SELECT * FROM proactive_prompt_revisions WHERE revision_id = ?').get(id) as Row | undefined;
    if (!draft || draft.status !== 'draft') throw new Error('Prompt draft not found');
    const nowIso = now.toISOString();
    const subscriptionId = text(draft, 'subscription_id');
    db.prepare("UPDATE proactive_prompt_revisions SET status = 'retired' WHERE subscription_id = ? AND status = 'published'").run(subscriptionId);
    db.prepare("UPDATE proactive_prompt_revisions SET status = 'published', published_at = ? WHERE revision_id = ?").run(nowIso, id);
    db.prepare('UPDATE proactive_scenario_subscriptions SET active_prompt_revision_id = ?, updated_at = ? WHERE subscription_id = ?')
      .run(id, nowIso, subscriptionId);
    return revisionFromRow(db.prepare('SELECT * FROM proactive_prompt_revisions WHERE revision_id = ?').get(id) as Row);
  });
}

export function rollbackPromptRevision(id: string, now = new Date()): PromptRevision {
  return runSqliteWriteTransaction((db) => {
    const target = db.prepare('SELECT * FROM proactive_prompt_revisions WHERE revision_id = ?').get(id) as Row | undefined;
    if (!target || target.status === 'draft') throw new Error('Published prompt revision not found');
    const nowIso = now.toISOString();
    const subscriptionId = text(target, 'subscription_id');
    db.prepare("UPDATE proactive_prompt_revisions SET status = 'retired' WHERE subscription_id = ? AND status = 'published'").run(subscriptionId);
    db.prepare("UPDATE proactive_prompt_revisions SET status = 'published', published_at = ? WHERE revision_id = ?").run(nowIso, id);
    db.prepare('UPDATE proactive_scenario_subscriptions SET active_prompt_revision_id = ?, updated_at = ? WHERE subscription_id = ?')
      .run(id, nowIso, subscriptionId);
    return revisionFromRow(db.prepare('SELECT * FROM proactive_prompt_revisions WHERE revision_id = ?').get(id) as Row);
  });
}

export function publishInstructionFeedback(input: {
  subscriptionId: string;
  inboxItemId: string;
  instruction: string;
}, now = new Date()): PromptRevision {
  const normalized = input.instruction.trim();
  if (!normalized) throw new Error('instruction is required');
  if (normalized.length > 2_000) throw new Error('instruction exceeds 2000 characters');
  return runSqliteWriteTransaction((db) => {
    const subscription = db.prepare('SELECT * FROM proactive_scenario_subscriptions WHERE subscription_id = ?')
      .get(input.subscriptionId) as Row | undefined;
    if (!subscription) throw new Error('Subscription not found');
    const scenario = db.prepare('SELECT * FROM proactive_scenarios WHERE scenario_key = ?')
      .get(text(subscription, 'scenario_key')) as Row;
    const active = subscription.active_prompt_revision_id
      ? db.prepare('SELECT user_instructions FROM proactive_prompt_revisions WHERE revision_id = ?')
        .get(text(subscription, 'active_prompt_revision_id')) as { user_instructions?: string } | undefined
      : undefined;
    const instructions = [
      active?.user_instructions?.trim() ?? '',
      `User feedback (${now.toISOString()}): ${normalized}`,
    ].filter(Boolean).join('\n').slice(-12_000);
    const next = db.prepare('SELECT COALESCE(MAX(revision), 0) + 1 AS revision FROM proactive_prompt_revisions WHERE subscription_id = ?')
      .get(input.subscriptionId) as { revision: number };
    const revisionId = randomUUID();
    const baseTemplateVersion = Number(scenario.base_template_version);
    const hash = createHash('sha256').update(`${baseTemplateVersion}:${instructions}`).digest('hex');
    const nowIso = now.toISOString();
    db.prepare("UPDATE proactive_prompt_revisions SET status = 'retired' WHERE subscription_id = ? AND status = 'published'")
      .run(input.subscriptionId);
    db.prepare(`INSERT INTO proactive_prompt_revisions
      (revision_id, subscription_id, revision, status, base_template_version, user_instructions, content_hash, created_at, published_at)
      VALUES (?, ?, ?, 'published', ?, ?, ?, ?, ?)`)
      .run(revisionId, input.subscriptionId, next.revision, baseTemplateVersion, instructions, hash, nowIso, nowIso);
    db.prepare('UPDATE proactive_scenario_subscriptions SET active_prompt_revision_id = ?, updated_at = ? WHERE subscription_id = ?')
      .run(revisionId, nowIso, input.subscriptionId);
    db.prepare(`INSERT INTO proactive_instruction_feedback
      (instruction_id, inbox_item_id, prompt_revision_id, instruction, created_at) VALUES (?, ?, ?, ?, ?)`)
      .run(randomUUID(), input.inboxItemId, revisionId, normalized, nowIso);
    return revisionFromRow(db.prepare('SELECT * FROM proactive_prompt_revisions WHERE revision_id = ?').get(revisionId) as Row);
  });
}
