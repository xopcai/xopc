import type { DatabaseSync } from 'node:sqlite';

import type { SceneContextProvider, SceneEvidence } from './execution.js';
import type { SceneActivation } from './contracts.js';
import { SceneSourceNotReady } from './readiness.js';

/** Explicit notes belong to one delegation, not an implicit family-wide data grant. */
export class SceneUserNotesProvider implements SceneContextProvider {
  readonly id = 'user_notes';
  constructor(private readonly db: DatabaseSync, private readonly clock: () => number = Date.now) {}

  setupIssues(activation: SceneActivation): string[] { return activation.scope.kind === 'personal' ? [] : ['personal_notes_scope']; }
  authorization(activation: SceneActivation): string[] | null { return activation.scope.kind === 'personal' ? [] : null; }

  async read(input: Parameters<SceneContextProvider['read']>[0]): Promise<SceneEvidence[]> {
    input.signal.throwIfAborted();
    if (!input.permissions.contextProviders.includes(this.id) || input.activation.scope.kind !== 'personal') throw new Error('Personal notes permission is required');
    const row = this.db.prepare(`SELECT n.content, n.revision, n.valid_until, n.updated_at
      FROM scene_activations a LEFT JOIN scene_notes n ON n.activation_id = a.id
      WHERE a.id = ? AND a.owner_id = ? AND a.workspace_id = ? AND a.status = 'active'
        AND json_extract(a.scope_json, '$.kind') = 'personal'`)
      .get(input.activation.id, input.activation.ownerId, input.activation.workspaceId);
    if (!row) throw new Error('Personal notes are unavailable');
    if (row.content === null || row.content === '') return [];
    const now = this.clock();
    if (row.valid_until !== null && Number(row.valid_until) <= now) throw new SceneSourceNotReady();
    return [{
      id: `scene-notes:${input.activation.id}`, subjectId: input.activation.id,
      ownerId: input.activation.ownerId, workspaceId: input.activation.workspaceId,
      revision: String(row.revision), occurredAt: Number(row.updated_at), content: String(row.content),
      freshUntil: Math.min(now + 60_000, row.valid_until === null ? Infinity : Number(row.valid_until)),
    }];
  }
}
