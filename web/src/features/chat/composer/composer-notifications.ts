import { showActivity, type ActivityTone } from '@/stores/activity-store';

/**
 * Record transient action feedback in the activity center without changing the
 * chat composer height. The composer intentionally has no inline notice surface.
 * Supports `{{key}}` template interpolation.
 */
export function showComposerNotification(
  level: ActivityTone,
  template: string,
  params?: Record<string, string | number>,
  options?: { duration?: number; href?: string },
): void {
  const message = params
    ? template.replace(/\{\{(\w+)\}\}/g, (_, key: string) => String(params[key] ?? ''))
    : template;

  showActivity({
    tone: level,
    title: message,
    href: options?.href,
    dedupeKey: `action-feedback:${level}:${message}`,
  });
}
