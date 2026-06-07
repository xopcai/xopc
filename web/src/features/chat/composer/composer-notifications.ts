import { showToast, type ToastType } from '@/lib/toast';

/**
 * Show a toast notification via the global toast host.
 * Supports `{{key}}` template interpolation.
 */
export function showComposerNotification(
  level: ToastType,
  template: string,
  params?: Record<string, string | number>,
  options?: { duration?: number },
): void {
  const message = params
    ? template.replace(/\{\{(\w+)\}\}/g, (_, key: string) => String(params[key] ?? ''))
    : template;

  showToast({
    type: level,
    title: message,
    duration: options?.duration ?? 4000,
  });
}
