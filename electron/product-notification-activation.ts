import { NotificationTargetSchema, notificationTargetRoute, type NotificationTarget } from '@xopcai/gateway-contract';

function escapeXml(value: string): string {
  return value.replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f]/g, '').replace(/[&<>"']/g, char => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&apos;' })[char]!);
}

export function productNotificationToastXml(input: { title: string; body: string; target: NotificationTarget; silent: boolean }): string {
  const activation = JSON.stringify({ xopcNotification: 1, target: input.target });
  return `<toast launch="${escapeXml(activation)}"><visual><binding template="ToastGeneric"><text>${escapeXml(input.title)}</text><text>${escapeXml(input.body)}</text></binding></visual>${input.silent ? '<audio silent="true"/>' : ''}</toast>`;
}

export function productNotificationActivationRoute(argumentsText: string): string | null {
  if (!argumentsText || argumentsText.length > 8192) return null;
  try {
    const value = JSON.parse(argumentsText) as { xopcNotification?: unknown; target?: unknown } | null;
    if (value?.xopcNotification !== 1) return null;
    const target = NotificationTargetSchema.safeParse(value.target);
    return target.success ? notificationTargetRoute(target.data, 'web') : null;
  } catch {
    return null;
  }
}
