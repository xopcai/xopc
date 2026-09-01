import { z } from 'zod';

export const NotificationTargetSchema = z.discriminatedUnion('kind', [
  z.object({ kind: z.literal('chat'), sessionKey: z.string().min(1) }),
  z.object({ kind: z.literal('task'), taskId: z.string().min(1) }),
  z.object({
    kind: z.literal('automation_run'),
    automationId: z.string().min(1),
    runId: z.string().min(1),
  }),
  z.object({ kind: z.literal('insight'), inboxItemId: z.string().min(1) }),
]);

export type NotificationTarget = z.infer<typeof NotificationTargetSchema>;
export type NotificationSurface = 'web' | 'mobile';

export const ProductNotificationTypeSchema = z.enum([
  'chat.completed',
  'chat.failed',
  'task.needs_input',
  'task.blocked',
  'task.failed',
  'task.completed',
  'automation.completed',
  'automation.failed',
  'proactive.insight',
]);

export const NotificationLocalizedTextSchema = z.object({
  en: z.string().min(1).max(500),
  zh: z.string().min(1).max(500),
});

export const ProductNotificationSchema = z.object({
  schemaVersion: z.literal(1),
  id: z.string().min(1).max(160),
  type: ProductNotificationTypeSchema,
  target: NotificationTargetSchema,
  priority: z.enum(['normal', 'high']),
  title: NotificationLocalizedTextSchema,
  body: NotificationLocalizedTextSchema.optional(),
  payload: z.record(z.string(), z.unknown()),
  createdAt: z.number().int().nonnegative(),
});

export type ProductNotification = z.infer<typeof ProductNotificationSchema>;
export type ProductNotificationType = z.infer<typeof ProductNotificationTypeSchema>;
export type NotificationLanguage = 'en' | 'zh';

export function localizeNotification(
  notification: ProductNotification,
  language: NotificationLanguage,
): ProductNotification & { localizedTitle: string; localizedBody?: string } {
  return {
    ...notification,
    localizedTitle: notification.title[language],
    ...(notification.body ? { localizedBody: notification.body[language] } : {}),
  };
}

export function notificationTargetRoute(
  target: NotificationTarget,
  surface: NotificationSurface,
): string {
  switch (target.kind) {
    case 'chat':
      return `/chat/${encodeURIComponent(target.sessionKey)}`;
    case 'task':
      return `/tasks/${encodeURIComponent(target.taskId)}`;
    case 'automation_run':
      return surface === 'mobile'
        ? `/automation/runs/${encodeURIComponent(target.runId)}`
        : `/automations?automation=${encodeURIComponent(target.automationId)}&run=${encodeURIComponent(target.runId)}`;
    case 'insight':
      return `/inbox?item=${encodeURIComponent(target.inboxItemId)}`;
  }
}

export function parseNotificationTarget(value: unknown): NotificationTarget | null {
  const parsed = NotificationTargetSchema.safeParse(value);
  return parsed.success ? parsed.data : null;
}
