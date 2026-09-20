import { createHash } from 'node:crypto';
import type { DatabaseSync } from 'node:sqlite';

import { z } from 'zod';

import type { SceneCutoverBindings } from './bindings.js';

// This is an import contract, deliberately independent of the retired runtime config schema.
const heartbeatSchema = z.strictObject({
  enabled: z.boolean(), intervalMs: z.number().finite(), includeSystemPromptSection: z.boolean().optional(),
  target: z.string().optional(), targetChatId: z.string().optional(), prompt: z.string().optional(),
  ackMaxChars: z.number().finite().optional(), isolatedSession: z.boolean().optional(),
  activeHours: z.strictObject({ start: z.string(), end: z.string(), timezone: z.string().optional() }).optional(),
});
const checklistSchema = z.array(z.strictObject({
  workspaceId: z.string().min(1), sourcePath: z.string().min(1), content: z.string().nullable(),
})).max(10_000).refine((rows) => new Set(rows.map((row) => row.workspaceId)).size === rows.length, 'Duplicate checklist workspace');
export type SceneChecklistImport = z.infer<typeof checklistSchema>[number];

/** Preserves private files and explicit configuration, without creating timers or granting tools. */
export function convertSceneHeartbeat(db: DatabaseSync, input: {
  config: Readonly<Record<string, unknown>>; owners: SceneCutoverBindings;
  configWorkspaceId?: string; checklists: SceneChecklistImport[];
  activations: Array<{ workspaceId: string; activationId: string }>;
}): number {
  const gateway = z.object({ heartbeat: heartbeatSchema.optional() }).optional().parse(input.config.gateway);
  const heartbeat = gateway?.heartbeat;
  const checklists = checklistSchema.parse(input.checklists);
  if (heartbeat && !input.configWorkspaceId) throw new Error('Heartbeat configuration requires explicit workspace ownership');
  const owners = new Map(input.owners.map((row) => [row.workspaceId, row.ownerId]));
  const activations = new Map(input.activations.map((row) => [row.workspaceId, row.activationId]));
  const workspaces = new Set(checklists.map((row) => row.workspaceId));
  if (heartbeat) workspaces.add(input.configWorkspaceId!);
  db.exec('SAVEPOINT scene_heartbeat_conversion');
  try {
    for (const workspaceId of workspaces) {
      const activationId = activations.get(workspaceId);
      const activation = activationId && db.prepare('SELECT * FROM scene_activations WHERE id = ?').get(activationId);
      if (!activation || !owners.has(workspaceId) || activation.owner_id !== owners.get(workspaceId)
        || activation.workspace_id !== workspaceId || activation.status !== 'needs_setup') throw new Error('Checklist import requires an inactive owner-bound activation');
      const checklist = checklists.find((row) => row.workspaceId === workspaceId);
      const policy = workspaceId === input.configWorkspaceId ? heartbeat : undefined;
      db.prepare(`INSERT INTO scene_checklist_imports (activation_id, source_path, content, content_hash, config_present,
        enabled, interval_ms, include_system_prompt, target, target_chat_id, prompt, ack_max_chars, isolated_session,
        active_start, active_end, active_timezone) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`)
        .run(activationId!, checklist?.sourcePath ?? null, checklist?.content ?? null,
          checklist?.content === null || checklist?.content === undefined ? null : createHash('sha256').update(checklist.content).digest('hex'),
          policy ? 1 : 0, policy ? Number(policy.enabled) : null, policy?.intervalMs ?? null,
          policy?.includeSystemPromptSection === undefined ? null : Number(policy.includeSystemPromptSection),
          policy?.target ?? null, policy?.targetChatId ?? null, policy?.prompt ?? null, policy?.ackMaxChars ?? null,
          policy?.isolatedSession === undefined ? null : Number(policy.isolatedSession),
          policy?.activeHours?.start ?? null, policy?.activeHours?.end ?? null, policy?.activeHours?.timezone ?? null);
    }
    db.exec('RELEASE scene_heartbeat_conversion');
    return workspaces.size;
  } catch (error) {
    db.exec('ROLLBACK TO scene_heartbeat_conversion'); db.exec('RELEASE scene_heartbeat_conversion'); throw error;
  }
}
