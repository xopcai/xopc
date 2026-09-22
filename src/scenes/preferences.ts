import type { DatabaseSync } from 'node:sqlite';

import { z } from 'zod';

import type { ScenePrincipal } from './contracts.js';
import { SceneConflictError, SceneNotFoundError } from './repository.js';

import { ScenePreferencePatchSchema, scenePreferencesSchema, type ScenePreferences } from '@xopcai/gateway-contract';
export { scenePreferencesSchema, type ScenePreferences } from '@xopcai/gateway-contract';

/** Owner-scoped choices. Muting presentation never changes check permissions or deletes work. */
export class ScenePreferenceService {
  constructor(private readonly db: DatabaseSync) {}

  get database() { return this.db; }

  get(principal: ScenePrincipal): ScenePreferences & { revision: number } {
    this.assertPrincipal(principal);
    const row = this.db.prepare('SELECT preferences_json, revision FROM scene_preferences WHERE owner_id = ? AND workspace_id = ?')
      .get(principal.ownerId, principal.workspaceId);
    return { ...scenePreferencesSchema.parse(row ? JSON.parse(String(row.preferences_json)) : {}), revision: row ? Number(row.revision) : 0 };
  }

  update(principal: ScenePrincipal, value: unknown): ScenePreferences & { revision: number } {
    this.assertPrincipal(principal);
    const { expectedRevision, ...parsed } = ScenePreferencePatchSchema.parse(value);
    const patch = Object.fromEntries(Object.entries(parsed).filter(([, value]) => value !== undefined));
    this.db.exec('SAVEPOINT scene_preferences_write');
    try {
      const { revision, ...current } = this.get(principal);
      if (revision !== expectedRevision) throw new SceneConflictError('Scene preferences changed');
      const next = scenePreferencesSchema.parse({ ...current, ...patch });
      this.db.prepare(`INSERT INTO scene_preferences(owner_id, workspace_id, preferences_json, revision) VALUES (?, ?, ?, ?)
        ON CONFLICT(owner_id, workspace_id) DO UPDATE SET preferences_json = excluded.preferences_json, revision = excluded.revision`)
        .run(principal.ownerId, principal.workspaceId, JSON.stringify(next), revision + 1);
      if (next.checksPaused !== current.checksPaused || next.checksPausedUntil !== current.checksPausedUntil) {
        this.db.prepare("UPDATE scene_activations SET revision = revision + 1 WHERE owner_id = ? AND workspace_id = ? AND status = 'active'")
          .run(principal.ownerId, principal.workspaceId);
        this.db.prepare(`UPDATE scene_runs SET status = 'cancelled', reason = 'check_policy_changed', lease_epoch = lease_epoch + 1,
          lease_owner = NULL, lease_until = NULL WHERE status IN ('running', 'retry_wait') AND activation_id IN
          (SELECT id FROM scene_activations WHERE owner_id = ? AND workspace_id = ?)`)
          .run(principal.ownerId, principal.workspaceId);
        this.db.prepare(`UPDATE scene_trigger_intents SET status = 'cancelled' WHERE status IN ('pending', 'claimed') AND activation_id IN
          (SELECT id FROM scene_activations WHERE owner_id = ? AND workspace_id = ?)`)
          .run(principal.ownerId, principal.workspaceId);
      }
      this.db.exec('RELEASE scene_preferences_write');
      return { ...next, revision: revision + 1 };
    } catch (error) {
      this.db.exec('ROLLBACK TO scene_preferences_write'); this.db.exec('RELEASE scene_preferences_write'); throw error;
    }
  }

  recordPresence(principal: ScenePrincipal, value: unknown, now = Date.now()): void {
    this.assertPrincipal(principal);
    const input = z.strictObject({ clientId: z.string().trim().min(1).max(100),
      surface: z.enum(['web', 'electron']), presentationId: z.string().min(1).max(200), visible: z.boolean() }).parse(value);
    if (!input.visible) {
      this.db.prepare('DELETE FROM notification_presence WHERE owner_id = ? AND workspace_id = ? AND client_id = ?')
        .run(principal.ownerId, principal.workspaceId, input.clientId);
      return;
    }
    const row = this.db.prepare(`SELECT p.notification_revision FROM scene_presentations p
      JOIN scene_outcomes o ON o.id = p.outcome_id JOIN scene_runs r ON r.id = o.run_id
      JOIN scene_activations a ON a.id = r.activation_id
      WHERE p.id = ? AND a.owner_id = ? AND a.workspace_id = ? AND p.withdrawn_at IS NULL`)
      .get(input.presentationId, principal.ownerId, principal.workspaceId);
    if (!row) throw new SceneNotFoundError('Scene result not found');
    this.db.prepare(`INSERT INTO notification_presence VALUES (?, ?, ?, ?, ?, ?, ?)
      ON CONFLICT(owner_id, workspace_id, client_id) DO UPDATE SET surface = excluded.surface,
        expires_at = excluded.expires_at, subject_id = excluded.subject_id, subject_revision = excluded.subject_revision`)
      .run(principal.ownerId, principal.workspaceId, input.clientId, input.surface, now + 45_000, input.presentationId, row.notification_revision);
    this.db.prepare('DELETE FROM notification_presence WHERE expires_at <= ?').run(now);
  }

  private assertPrincipal(principal: ScenePrincipal): void {
    if (!principal.ownerId.trim() || !principal.workspaceId.trim()) throw new Error('Scene principal is required');
  }
}

export function sceneChecksAllowed(preferences: ScenePreferences, now: number): boolean {
  return !preferences.checksPaused && !(preferences.checksPausedUntil && Date.parse(preferences.checksPausedUntil) > now);
}
