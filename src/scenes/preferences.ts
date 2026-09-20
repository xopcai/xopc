import type { DatabaseSync } from 'node:sqlite';

import { z } from 'zod';

import type { ScenePrincipal } from './contracts.js';
import { SceneConflictError } from './repository.js';

const hour = z.number().int().min(0).max(23);
export const scenePreferencesSchema = z.strictObject({
  level: z.enum(['quiet', 'balanced', 'active']).default('balanced'),
  timezone: z.string().min(1).max(100).refine((value) => {
    try { new Intl.DateTimeFormat('en', { timeZone: value }); return true; } catch { return false; }
  }).default('Asia/Shanghai'),
  quietStartHour: hour.default(22), quietEndHour: hour.default(8),
  dailyNotificationLimit: z.number().int().min(0).max(30).default(3),
  digestEnabled: z.boolean().default(false), digestHour: hour.default(18),
  digestMinute: z.number().int().min(0).max(59).default(0),
  preferredChannel: z.enum(['all', 'auto', 'browser', 'mobile', 'telegram']).default('all'),
  suppressWhileViewing: z.boolean().default(true),
  telegram: z.strictObject({
    chatId: z.string().regex(/^-?[0-9]{1,20}$/), accountId: z.string().min(1).max(100).optional(),
    publicUrl: z.string().url().refine((value) => {
      const url = new URL(value);
      return url.protocol === 'https:' && !url.username && !url.password && !url.search && !url.hash;
    }),
  }).nullable().default(null),
  checksPaused: z.boolean().default(false),
  checksPausedUntil: z.string().datetime({ offset: true }).nullable().default(null),
  notificationsMuted: z.boolean().default(false),
});
export type ScenePreferences = z.infer<typeof scenePreferencesSchema>;

/** Owner-scoped choices. Muting presentation never changes check permissions or deletes work. */
export class ScenePreferenceService {
  constructor(private readonly db: DatabaseSync) {}

  get(principal: ScenePrincipal): ScenePreferences & { revision: number } {
    this.assertPrincipal(principal);
    const row = this.db.prepare('SELECT preferences_json, revision FROM scene_preferences WHERE owner_id = ? AND workspace_id = ?')
      .get(principal.ownerId, principal.workspaceId);
    return { ...scenePreferencesSchema.parse(row ? JSON.parse(String(row.preferences_json)) : {}), revision: row ? Number(row.revision) : 0 };
  }

  update(principal: ScenePrincipal, value: unknown): ScenePreferences & { revision: number } {
    this.assertPrincipal(principal);
    const supplied = z.record(z.string(), z.unknown()).parse(value);
    const { expectedRevision, ...parsed } = scenePreferencesSchema.partial().extend({ expectedRevision: z.number().int().nonnegative() }).parse(value);
    // Zod defaults inside optional fields must not reset unspecified preferences in a patch.
    const patch = Object.fromEntries(Object.entries(parsed).filter(([key]) => Object.hasOwn(supplied, key) && supplied[key] !== undefined));
    this.db.exec('SAVEPOINT scene_preferences_write');
    try {
      const { revision, ...current } = this.get(principal);
      if (revision !== expectedRevision) throw new SceneConflictError('Scene preferences changed');
      const next = scenePreferencesSchema.parse({ ...current, ...patch });
      if (next.preferredChannel === 'telegram' && !next.telegram) throw new Error('Telegram destination is required');
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

  private assertPrincipal(principal: ScenePrincipal): void {
    if (!principal.ownerId.trim() || !principal.workspaceId.trim()) throw new Error('Scene principal is required');
  }
}

export function sceneChecksAllowed(preferences: ScenePreferences, now: number): boolean {
  return !preferences.checksPaused && !(preferences.checksPausedUntil && Date.parse(preferences.checksPausedUntil) > now);
}
