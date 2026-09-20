import { createHash } from 'node:crypto';

import { z } from 'zod';

// Migration format v1. Keep independent of future application contract changes.
const identifier = z.string().trim().min(1).max(200);
const uniqueIds = z.array(identifier).max(100).refine((items) => new Set(items).size === items.length, 'Duplicate identifiers');

export const sceneScopeSchema = z.discriminatedUnion('kind', [
  z.strictObject({ kind: z.literal('personal') }),
  z.strictObject({ kind: z.literal('project'), id: identifier }),
  z.strictObject({ kind: z.literal('conversation'), id: identifier }),
  z.strictObject({ kind: z.literal('objects'), ids: uniqueIds.refine((ids) => ids.length > 0) }),
]);
export const scenePermissionSchema = z.strictObject({
  accountIds: uniqueIds,
  contextProviders: uniqueIds,
  effectHandlers: uniqueIds,
});
export const activationInputSchema = z.strictObject({
  templateKey: identifier,
  templateVersion: identifier,
  goal: z.string().trim().min(1).max(12_000),
  scope: sceneScopeSchema,
  permissions: scenePermissionSchema,
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

export function sceneContentHash(value: unknown): string {
  const canonical = (item: unknown): string => {
    if (item === null || typeof item === 'string' || typeof item === 'boolean') return JSON.stringify(item);
    if (typeof item === 'number' && Number.isFinite(item)) return JSON.stringify(item);
    if (Array.isArray(item)) return `[${item.map(canonical).join(',')}]`;
    if (typeof item === 'object' && Object.getPrototypeOf(item) === Object.prototype) {
      return `{${Object.keys(item).sort().map((key) => `${JSON.stringify(key)}:${canonical((item as Record<string, unknown>)[key])}`).join(',')}}`;
    }
    throw new Error('Scene content must be finite JSON');
  };
  return createHash('sha256').update(canonical(value)).digest('hex');
}


/** Only supported public browser-push providers may receive subscription requests. */
export function allowedPushEndpoint(value: string): boolean {
  try {
    const url = new URL(value);
    const host = url.hostname;
    return url.protocol === 'https:' && !url.username && !url.password && (!url.port || url.port === '443')
      && (host === 'fcm.googleapis.com' || host === 'updates.push.services.mozilla.com'
        || host.endsWith('.push.services.mozilla.com') || host === 'web.push.apple.com'
        || host.endsWith('.notify.windows.com'));
  } catch { return false; }
}
