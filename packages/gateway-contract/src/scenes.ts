import { z } from 'zod';

const identifier = z.string().trim().min(1).max(200);
const uniqueIds = z.array(identifier).max(100).refine((items) => new Set(items).size === items.length, 'Duplicate identifiers');

export const sceneOutcomeKinds = ['no_change', 'observation', 'artifact', 'decision', 'state_change', 'effect_proposal', 'receipt'] as const;
export const activationStatuses = ['needs_setup', 'active', 'paused', 'completed', 'archived'] as const;
export type ActivationStatus = typeof activationStatuses[number];

export const sceneScopeSchema = z.discriminatedUnion('kind', [
  z.strictObject({ kind: z.literal('personal') }),
  z.strictObject({ kind: z.literal('project'), id: identifier }),
  z.strictObject({ kind: z.literal('conversation'), id: identifier }),
  z.strictObject({ kind: z.literal('objects'), ids: uniqueIds.refine((ids) => ids.length > 0) }),
]);
export type SceneScope = z.infer<typeof sceneScopeSchema>;

const limitsSchema = z.strictObject({
  timeoutSeconds: z.number().int().min(1).max(600),
  maxIterations: z.number().int().min(1).max(30),
  maxToolCalls: z.number().int().min(0).max(100),
  maxOutputTokens: z.number().int().min(1).max(32_768),
});

const executionSchema = z.strictObject({
  kind: z.string().regex(/^[a-z][a-z0-9_-]{0,63}$/),
  instruction: z.string().trim().min(1).max(32_000),
  limits: limitsSchema,
});

export const sceneTemplateSchema = z.strictObject({
  schemaVersion: z.literal(1),
  key: z.string().regex(/^[a-z][a-z0-9-]{0,79}$/),
  version: z.string().regex(/^\d+\.\d+\.\d+$/),
  title: z.string().trim().min(1).max(120),
  description: z.string().trim().min(1).max(2000),
  goalMode: z.enum(['finite', 'ongoing']),
  contextProviders: uniqueIds,
  triggers: z.array(z.discriminatedUnion('type', [
    z.strictObject({ id: identifier, type: z.literal('manual') }),
    z.strictObject({ id: identifier, type: z.literal('event'), eventType: identifier }),
    z.strictObject({ id: identifier, type: z.literal('schedule') }),
  ])).min(1).max(20).refine((items) => new Set(items.map((item) => item.id)).size === items.length, 'Duplicate trigger IDs'),
  execution: executionSchema,
  allowedOutcomeKinds: z.array(z.enum(sceneOutcomeKinds)).min(1),
  allowedEffectHandlers: uniqueIds,
});
export type SceneTemplate = z.infer<typeof sceneTemplateSchema>;

export interface ScenePrincipal { ownerId: string; workspaceId: string }

export const scenePermissionSchema = z.strictObject({
  accountIds: uniqueIds,
  contextProviders: uniqueIds,
  effectHandlers: uniqueIds,
});
export type ScenePermission = z.infer<typeof scenePermissionSchema>;

export const sceneNotesSchema = z.strictObject({
  expectedRevision: z.number().int().nonnegative(),
  content: z.string().trim().max(32_000),
  validUntil: z.number().int().nonnegative().nullable().default(null),
});

export const activationInputSchema = z.strictObject({
  templateKey: identifier,
  templateVersion: identifier,
  goal: z.string().trim().min(1).max(12_000),
  scope: sceneScopeSchema,
  permissions: scenePermissionSchema,
});
export type ActivationInput = z.infer<typeof activationInputSchema>;
export interface SceneActivation extends ActivationInput, ScenePrincipal {
  id: string;
  status: ActivationStatus;
  setupMissing?: string[];
  revision: number;
}

export const SceneActivationSchema = activationInputSchema.extend({
  id: identifier, ownerId: identifier, workspaceId: z.string().min(1), status: z.enum(activationStatuses),
  setupMissing: z.array(z.string()).optional(), revision: z.number().int().positive(),
});
export const SceneConfigureSchema = activationInputSchema.pick({ goal: true, scope: true, permissions: true })
  .extend({ expectedRevision: z.number().int().positive() });
export const SceneTransitionSchema = z.strictObject({ expectedRevision: z.number().int().positive(), status: z.enum(activationStatuses) });
export const SceneWorkItemCreateSchema = z.strictObject({
  subjectId: identifier, accountId: identifier, dueAt: z.number().int().nonnegative(),
});
export const SceneWorkItemUpdateSchema = z.strictObject({
  expectedRevision: z.number().int().positive(), dueAt: z.number().int().nonnegative().optional(),
  status: z.enum(['watching', 'paused', 'completed']).optional(),
}).refine(value => value.dueAt !== undefined || value.status !== undefined, 'Work item update is empty');
export const SceneWorkItemSchema = SceneWorkItemCreateSchema.extend({
  id: identifier, activationId: identifier, revision: z.number().int().positive(), status: z.enum(['watching', 'paused', 'completed']),
});

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
  preferredChannel: z.enum(['in_app', 'browser']).default('browser'),
  suppressWhileViewing: z.boolean().default(true),
  checksPaused: z.boolean().default(false),
  checksPausedUntil: z.string().datetime({ offset: true }).nullable().default(null),
  notificationsMuted: z.boolean().default(false),
});
export type ScenePreferences = z.infer<typeof scenePreferencesSchema>;

const preferenceFields = scenePreferencesSchema.shape;
export const ScenePreferencePatchSchema = z.strictObject({
  expectedRevision: z.number().int().nonnegative(),
  level: preferenceFields.level.removeDefault().optional(), timezone: preferenceFields.timezone.removeDefault().optional(),
  quietStartHour: preferenceFields.quietStartHour.removeDefault().optional(), quietEndHour: preferenceFields.quietEndHour.removeDefault().optional(),
  dailyNotificationLimit: preferenceFields.dailyNotificationLimit.removeDefault().optional(),
  digestEnabled: preferenceFields.digestEnabled.removeDefault().optional(), digestHour: preferenceFields.digestHour.removeDefault().optional(),
  digestMinute: preferenceFields.digestMinute.removeDefault().optional(), preferredChannel: preferenceFields.preferredChannel.removeDefault().optional(),
  suppressWhileViewing: preferenceFields.suppressWhileViewing.removeDefault().optional(), checksPaused: preferenceFields.checksPaused.removeDefault().optional(),
  checksPausedUntil: preferenceFields.checksPausedUntil.removeDefault().optional(), notificationsMuted: preferenceFields.notificationsMuted.removeDefault().optional(),
});
export const SceneFeedbackSchema = z.strictObject({
  expectedRevision: z.number().int().nonnegative(), rating: z.enum(['useful', 'not_useful']), note: z.string().trim().max(2000).optional(),
});
/** A local wall-clock schedule, not an arbitrary cron or workflow language. */
export const sceneScheduleSchema = z.strictObject({
  weekdays: z.array(z.number().int().min(0).max(6)).min(1).max(7)
    .refine(days => new Set(days).size === days.length, 'Duplicate weekdays'),
  hour: z.number().int().min(0).max(23), minute: z.number().int().min(0).max(59),
  timeZone: z.string().trim().min(1).max(100).refine(timeZone => {
    try { new Intl.DateTimeFormat('en', { timeZone }); return true; } catch { return false; }
  }, 'Invalid time zone'),
});
