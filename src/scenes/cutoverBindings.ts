import type { DatabaseSync } from 'node:sqlite';

import { z } from 'zod';

import { inspectSceneCutover } from './cutoverPreflight.js';

const bindingsSchema = z.array(z.strictObject({
  workspaceId: z.string().trim().min(1).max(4096), ownerId: z.string().trim().min(1).max(200),
})).max(10000).refine((items) => new Set(items.map((item) => item.workspaceId)).size === items.length, 'Duplicate workspace ownership');
export type SceneCutoverBindings = z.infer<typeof bindingsSchema>;

/** Old workspace-wide data has no owner. An offline operator must bind it explicitly. */
export function resolveSceneCutoverBindings(db: DatabaseSync, value: unknown): SceneCutoverBindings {
  const bindings = bindingsSchema.parse(value);
  const owned = new Set(bindings.map((item) => item.workspaceId));
  for (const { name } of inspectSceneCutover(db).tables) {
    const table = `"${name.replaceAll('"', '""')}"`;
    if (!db.prepare(`PRAGMA table_info(${table})`).all().some((column) => column.name === 'workspace_id')) continue;
    const workspaces = db.prepare(`SELECT DISTINCT workspace_id FROM ${table} LIMIT 10001`).all();
    if (workspaces.length > 10000) throw new Error('Scene cutover ownership inventory exceeds its limit');
    for (const row of workspaces) {
      if (typeof row.workspace_id !== 'string' || !row.workspace_id.trim()) throw new Error(`Scene cutover contains an invalid workspace in ${name}`);
      if (!owned.has(row.workspace_id)) throw new Error(`Scene cutover requires explicit workspace ownership for ${name}`);
    }
  }
  return bindings;
}
