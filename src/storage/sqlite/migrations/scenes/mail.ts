import type { DatabaseSync } from 'node:sqlite';

import { z } from 'zod';

import { activationInputSchema } from './targetContract.js';
import type { SceneCutoverBindings } from './bindings.js';
import { installMigratedTemplate, mailFollowUpTemplate } from './targetTemplates.js';

const accountBindingsSchema = z.array(z.strictObject({
  followUpId: z.string().min(1).max(200), accountId: z.string().min(1).max(200),
})).max(10_000).refine((items) => new Set(items.map((item) => item.followUpId)).size === items.length, 'Duplicate follow-up account binding');

const historyTime = z.string().datetime({ offset: true }).transform((value) => Date.parse(value)).pipe(z.number().int().nonnegative());
const followUpSchema = z.strictObject({
  id: z.string().min(1).max(200), workspace_id: z.string().min(1), subscription_id: z.string().min(1),
  source_item_id: z.string().min(1).max(200), instructions: z.string().min(1).max(12_000),
  due_at: z.string().datetime({ offset: true, message: 'Invalid follow-up deadline' })
    .refine((value) => Number.isSafeInteger(Date.parse(value)), 'Invalid follow-up deadline'),
  revision: z.number().int().positive(), status: z.enum(['watching', 'paused', 'completed']),
  thread_key: z.string().min(1), last_fingerprint: z.string().nullable(), last_checked_at: historyTime.nullable(),
  conversation_id: z.string().min(1).nullable(), created_at: historyTime, updated_at: historyTime,
});

export interface SceneMailConversionLink {
  followUpId: string;
  subscriptionId: string;
  activationId: string;
  workItemId: string;
}

/** Offline conversion step. The coordinator removes source tables only after all history is mapped. */
export function convertSceneMailFollowUps(db: DatabaseSync, input: {
  owners: SceneCutoverBindings;
  accounts: unknown;
}): SceneMailConversionLink[] {
  const accounts = accountBindingsSchema.parse(input.accounts);
  const owners = new Map(input.owners.map((binding) => [binding.workspaceId, binding.ownerId]));
  if (owners.size !== input.owners.length || input.owners.some((binding) => !binding.ownerId.trim() || !binding.workspaceId.trim())) {
    throw new Error('Invalid scene workspace ownership');
  }
  const records = db.prepare('SELECT * FROM proactive_follow_ups ORDER BY id LIMIT 10001').all().map((row) => followUpSchema.parse(row));
  if (records.length > 10_000) throw new Error('Mail conversion exceeds its reviewed batch limit');
  const accountMap = new Map(accounts.map((binding) => [binding.followUpId, binding.accountId]));
  const recordIds = new Set(records.map((record) => record.id));
  if (accounts.some((binding) => !recordIds.has(binding.followUpId))) throw new Error('Account binding references an unknown follow-up');
  const plans = records.map((record) => {
    const ownerId = owners.get(record.workspace_id);
    const accountId = accountMap.get(record.id);
    if (!ownerId || !accountId) throw new Error('Mail conversion requires explicit owner and account bindings');
    const source = db.prepare(`SELECT k.item_id FROM knowledge_source_items k
      JOIN connector_connections c ON c.id = json_extract(CASE WHEN json_valid(k.metadata_json) THEN k.metadata_json ELSE '{}' END, '$.connectionId')
      JOIN connector_accounts a ON a.id = c.account_id AND a.principal_id = c.principal_id AND a.connector_id = c.connector_id
      WHERE k.item_id = ? AND k.item_type = 'email' AND a.id = ? AND a.principal_id = ?
      AND json_extract(k.metadata_json, '$.workspaceId') = ?`).get(record.source_item_id, accountId, ownerId, record.workspace_id);
    if (!source) throw new Error('Mail conversion source does not match its bound owner, workspace and account');
    const activation = activationInputSchema.parse({ templateKey: mailFollowUpTemplate.key, templateVersion: mailFollowUpTemplate.version,
      goal: record.instructions, scope: { kind: 'objects', ids: [record.source_item_id] },
      permissions: { accountIds: [accountId], contextProviders: ['mail'], effectHandlers: [] } });
    return { record, ownerId, accountId, activation };
  });

  db.exec('SAVEPOINT scene_mail_conversion');
  try {
    installMigratedTemplate(db, mailFollowUpTemplate);
    const links: SceneMailConversionLink[] = [];
    for (const { record, ownerId, accountId, activation } of plans) {
      db.prepare(`INSERT INTO scene_activations
        (id, owner_id, workspace_id, template_key, template_version, goal, scope_json, permissions_json, status, revision)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, 'needs_setup', 1)`)
        .run(record.id, ownerId, record.workspace_id, activation.templateKey, activation.templateVersion, activation.goal,
          JSON.stringify(activation.scope), JSON.stringify(activation.permissions));
      db.prepare(`INSERT INTO scene_work_items
        (id, activation_id, subject_id, account_id, due_at, revision, status, last_check_reason)
        VALUES (?, ?, ?, ?, ?, ?, ?, 'import_requires_review')`)
        .run(record.id, record.id, record.source_item_id, accountId, Date.parse(record.due_at), record.revision,
          record.status === 'completed' ? 'completed' : 'paused');
      db.prepare('INSERT INTO scene_mail_history VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)')
        .run(record.id, record.subscription_id, record.thread_key, record.status, record.last_fingerprint,
          record.last_checked_at, record.conversation_id, record.created_at, record.updated_at);
      links.push({ followUpId: record.id, subscriptionId: record.subscription_id, activationId: record.id, workItemId: record.id });
    }
    db.exec('RELEASE scene_mail_conversion');
    return links;
  } catch (error) {
    db.exec('ROLLBACK TO scene_mail_conversion');
    db.exec('RELEASE scene_mail_conversion');
    throw error;
  }
}
