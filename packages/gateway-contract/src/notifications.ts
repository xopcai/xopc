import { z } from 'zod';

export const NotificationTargetSchema = z.discriminatedUnion('kind', [
  z.object({ kind: z.literal('scene_result'), activationId: z.string().min(1), presentationId: z.string().min(1) }),
  z.object({ kind: z.literal('scene_digest'), digestId: z.string().min(1) }),
  z.object({ kind: z.literal('chat'), conversationId: z.string().min(1) }),
  z.object({ kind: z.literal('task'), taskId: z.string().min(1) }),
  z.object({
    kind: z.literal('automation_run'),
    automationId: z.string().min(1),
    runId: z.string().min(1),
  }),
  z.object({ kind: z.literal('proactive_digest'), digestId: z.string().min(1) }),
  z.object({ kind: z.literal('insight'), inboxItemId: z.string().min(1) }),
  z.object({
    kind: z.literal('work_discovery'),
    runId: z.string().min(1),
    conversationId: z.string().min(1),
  }),
]);

export type NotificationTarget = z.infer<typeof NotificationTargetSchema>;
export type NotificationSurface = 'web' | 'mobile';

export const ProductNotificationTypeSchema = z.enum([
  'scene.result',
  'scene.digest',
  'chat.completed',
  'chat.failed',
  'task.needs_input',
  'task.blocked',
  'task.failed',
  'task.completed',
  'automation.completed',
  'automation.failed',
  'proactive.insight',
  'work_discovery.completed',
  'work_discovery.failed',
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
    case 'scene_result':
      return `/scenes/${encodeURIComponent(target.activationId)}?result=${encodeURIComponent(target.presentationId)}`;
    case 'scene_digest':
      return `/scenes/inbox?digest=${encodeURIComponent(target.digestId)}`;
    case 'chat':
      return `/chat/${encodeURIComponent(target.conversationId)}`;
    case 'task':
      return `/tasks/${encodeURIComponent(target.taskId)}`;
    case 'automation_run':
      return surface === 'mobile'
        ? `/automation/runs/${encodeURIComponent(target.runId)}`
        : `/automations?automation=${encodeURIComponent(target.automationId)}&run=${encodeURIComponent(target.runId)}`;
    case 'proactive_digest':
      return surface === 'web' ? `/assistant-work?digest=${encodeURIComponent(target.digestId)}` : '/inbox';
    case 'insight':
      return surface === 'web'
        ? `/assistant-work?item=${encodeURIComponent(target.inboxItemId)}`
        : `/inbox?item=${encodeURIComponent(target.inboxItemId)}`;
    case 'work_discovery':
      return surface === 'web'
        ? `/user-model?workDiscovery=review&run=${encodeURIComponent(target.runId)}`
        : `/chat/${encodeURIComponent(target.conversationId)}`;
  }
}

export function parseNotificationTarget(value: unknown): NotificationTarget | null {
  const parsed = NotificationTargetSchema.safeParse(value);
  return parsed.success ? parsed.data : null;
}
