import { z } from 'zod';

export const ProactiveLevelSchema = z.enum(['off', 'quiet', 'balanced', 'active']);
export const ProactiveTimezoneSchema = z.string().min(1).max(100).refine((value) => {
  try { new Intl.DateTimeFormat('en', { timeZone: value }); return true; } catch { return false; }
}, 'Invalid timezone');
export const ProactivePreferencesSchema = z.object({
  level: ProactiveLevelSchema.default('balanced'),
  timezone: ProactiveTimezoneSchema.default('Asia/Shanghai'),
  quietStartHour: z.number().int().min(0).max(23).default(22),
  quietEndHour: z.number().int().min(0).max(23).default(8),
  dailyNotificationLimit: z.number().int().min(0).max(30).default(3),
  digestEnabled: z.boolean().default(false),
  digestHour: z.number().int().min(0).max(23).default(18),
  digestMinute: z.number().int().min(0).max(59).default(0),
  preferredChannel: z.enum(['all', 'auto', 'browser', 'mobile', 'telegram']).default('all'),
  suppressWhileViewing: z.boolean().default(true),
  telegram: z.object({ chatId: z.string().regex(/^-?[0-9]{1,20}$/), accountId: z.string().min(1).max(100).optional(), publicUrl: z.url().refine((value) => { const url = new URL(value); return url.protocol === 'https:' && !url.username && !url.password && !url.search && !url.hash; }, 'Use an HTTPS console URL without credentials or query parameters') }).nullable().default(null),
  pausedUntil: z.iso.datetime().nullable().default(null),
  revision: z.number().int().nonnegative().default(0),
});
export const ProactivePreferencesUpdateSchema = z.object({
  level: ProactivePreferencesSchema.shape.level.removeDefault().optional(),
  timezone: ProactivePreferencesSchema.shape.timezone.removeDefault().optional(),
  quietStartHour: ProactivePreferencesSchema.shape.quietStartHour.removeDefault().optional(),
  quietEndHour: ProactivePreferencesSchema.shape.quietEndHour.removeDefault().optional(),
  dailyNotificationLimit: ProactivePreferencesSchema.shape.dailyNotificationLimit.removeDefault().optional(),
  digestEnabled: ProactivePreferencesSchema.shape.digestEnabled.removeDefault().optional(),
  digestHour: ProactivePreferencesSchema.shape.digestHour.removeDefault().optional(),
  digestMinute: ProactivePreferencesSchema.shape.digestMinute.removeDefault().optional(),
  preferredChannel: ProactivePreferencesSchema.shape.preferredChannel.removeDefault().optional(),
  suppressWhileViewing: ProactivePreferencesSchema.shape.suppressWhileViewing.removeDefault().optional(),
  telegram: ProactivePreferencesSchema.shape.telegram.removeDefault().optional(),
  pausedUntil: ProactivePreferencesSchema.shape.pausedUntil.removeDefault().optional(),
  expectedRevision: z.number().int().nonnegative(),
}).strict();
export const ProactiveSubscriptionSettingsSchema = z.object({
  level: ProactiveLevelSchema.nullable().default(null),
  delivery: z.enum(['inbox', 'important', 'digest']).default('important'),
  preparationWorkflowId: z.string().min(1).max(160).nullable().default(null),
  scanIntervalMinutes: z.number().int().min(15).max(10080).nullable().default(null),
  userInstructions: z.string().max(12000).default(''),
});
export const ProactiveSubscriptionCreateSchema = ProactiveSubscriptionSettingsSchema.extend({
  scenarioKey: z.string().min(1).max(100),
  scopeKind: z.enum(['workspace', 'project']),
  scopeId: z.string().min(1).max(200),
  enabled: z.boolean().default(true),
}).strict();
export const ProactiveSubscriptionUpdateSchema = z.object({
  level: ProactiveSubscriptionSettingsSchema.shape.level.removeDefault().optional(),
  delivery: ProactiveSubscriptionSettingsSchema.shape.delivery.removeDefault().optional(),
  preparationWorkflowId: ProactiveSubscriptionSettingsSchema.shape.preparationWorkflowId.removeDefault().optional(),
  scanIntervalMinutes: ProactiveSubscriptionSettingsSchema.shape.scanIntervalMinutes.removeDefault().optional(),
  userInstructions: ProactiveSubscriptionSettingsSchema.shape.userInstructions.removeDefault().optional(),
  enabled: z.boolean().optional(),
  expectedRevision: z.number().int().nonnegative(),
}).strict();
export const ProactiveCardActionSchema = z.object({
  actionId: z.enum(['read', 'resolve', 'snooze', 'decide', 'less', 'pause', 'useful', 'not_useful', 'retry']),
  expectedRevision: z.number().int().positive(),
  idempotencyKey: z.string().min(8).max(128),
  choice: z.string().min(1).max(200).optional(),
  snoozedUntil: z.iso.datetime().optional(),
}).strict();
export type ProactiveLevel = z.infer<typeof ProactiveLevelSchema>;
export type ProactivePreferences = z.infer<typeof ProactivePreferencesSchema>;
export type ProactiveSubscriptionSettings = z.infer<typeof ProactiveSubscriptionSettingsSchema>;
export type ProactiveCardAction = z.infer<typeof ProactiveCardActionSchema>;
export type ProactiveCardKind = 'briefing' | 'reminder' | 'risk' | 'recommendation' | 'decision' | 'receipt';
export interface ProactiveCard {
  schemaVersion: 1;
  id: string;
  revision: number;
  notificationRevision: number;
  subscriptionId: string;
  scenarioKey: string;
  kind: ProactiveCardKind;
  status: 'unread' | 'read' | 'snoozed' | 'resolved' | 'expired' | 'withdrawn';
  preparationAvailable?: boolean;
  relatedCardIds?: string[];
  title: string;
  summary: string;
  whyNow: string;
  recommendation: string;
  workDone: string;
  evidence: Array<{ id: string; label: string; route?: string; excerpt?: string }>;
  decision?: { question: string; options: Array<{ id: string; label: string; consequence: string }> };
  actionStatus?: string;
  actionResult?: Record<string, unknown>;
  actionError?: string;
  createdAt: string;
  updatedAt: string;
  expiresAt?: string;
  fallbackText: string;
}
