type NotificationLevel = 'info' | 'warning' | 'error' | 'success';

/**
 * Show a toast notification via the global `extension-notification` event.
 * Supports `{{key}}` template interpolation.
 */
export function showComposerNotification(
  level: NotificationLevel,
  template: string,
  params?: Record<string, string | number>,
  options?: { duration?: number },
): void {
  const message = params
    ? template.replace(/\{\{(\w+)\}\}/g, (_, key: string) => String(params[key] ?? ''))
    : template;

  window.dispatchEvent(
    new CustomEvent('extension-notification', {
      detail: {
        type: level,
        title: message,
        duration: options?.duration ?? 4000,
      },
    }),
  );
}
