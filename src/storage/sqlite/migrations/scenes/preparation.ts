import { randomUUID } from 'node:crypto';
import type { DatabaseSync } from 'node:sqlite';

import { z } from 'zod';

import { resolveSceneCutoverBindings, type SceneCutoverBindings } from './bindings.js';
import { activationInputSchema } from './targetContract.js';
import { installMigratedTemplate, historyOnlyTemplate } from './targetTemplates.js';

/** Gives historical subscriptions an inert, owner-bound home rather than guessing a replacement executor. */
export function prepareSceneHistoryActivations(db: DatabaseSync, input: {
  owners: SceneCutoverBindings;
  checklistWorkspaces?: string[];
}) {
  const owners = new Map(resolveSceneCutoverBindings(db, input.owners).map((row) => [row.workspaceId, row.ownerId]));
  const source = db.prepare(`SELECT s.subscription_id, s.workspace_id, s.scope_kind, s.scope_id, d.title
    FROM proactive_scenario_subscriptions s LEFT JOIN proactive_scenarios d ON d.scenario_key = s.scenario_key
    ORDER BY s.subscription_id LIMIT 100001`).all();
  if (source.length > 100_000) throw new Error('History preparation exceeds reviewed limit');
  const subscriptions = source.map((row) => z.strictObject({ subscription_id: z.string().min(1), workspace_id: z.string().min(1),
    scope_kind: z.enum(['workspace', 'project']), scope_id: z.string().min(1), title: z.string() }).parse(row));
  const checkRows = db.prepare('SELECT DISTINCT workspace_id FROM heartbeat_checks LIMIT 10001').all();
  if (checkRows.length > 10_000) throw new Error('Checklist preparation exceeds reviewed limit');
  const checkWorkspaces = new Set([...checkRows.map((row) => String(row.workspace_id)),
    ...z.array(z.string().min(1)).max(10_000).parse(input.checklistWorkspaces ?? [])]);
  if ([...checkWorkspaces].some((workspace) => !owners.has(workspace))) throw new Error('Checklist workspace requires explicit ownership');
  db.exec('SAVEPOINT scene_history_preparation');
  try {
    installMigratedTemplate(db, historyOnlyTemplate);
    const make = (workspaceId: string, goal: string, scope: { kind: 'personal' } | { kind: 'project'; id: string }) => {
      const id = randomUUID();
      const activation = activationInputSchema.parse({
        templateKey: historyOnlyTemplate.key, templateVersion: historyOnlyTemplate.version, goal,
        scope, permissions: { accountIds: [], contextProviders: [], effectHandlers: [] },
      });
      db.prepare(`INSERT INTO scene_activations
        (id, owner_id, workspace_id, template_key, template_version, goal, scope_json, permissions_json, status, revision)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, 'needs_setup', 1)`)
        .run(id, owners.get(workspaceId)!, workspaceId, activation.templateKey, activation.templateVersion,
          activation.goal, JSON.stringify(activation.scope), JSON.stringify(activation.permissions));
      return id;
    };
    const activations = subscriptions.map((row) => ({ subscriptionId: row.subscription_id,
      activationId: make(row.workspace_id, row.title.trim() || '迁移前的场景历史', row.scope_kind === 'project' ? { kind: 'project', id: row.scope_id } : { kind: 'personal' }) }));
    const checks = [...checkWorkspaces].map((workspaceId) => ({ workspaceId,
      activationId: make(workspaceId, '迁移前的日常巡查历史', { kind: 'personal' }) }));
    db.exec('RELEASE scene_history_preparation');
    return { activations, checks };
  } catch (error) {
    db.exec('ROLLBACK TO scene_history_preparation'); db.exec('RELEASE scene_history_preparation'); throw error;
  }
}
