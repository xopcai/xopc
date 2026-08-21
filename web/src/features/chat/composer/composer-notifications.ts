import { COMPOSER_NOTICE_EVENT, type ComposerNoticeDetail, type ComposerNoticeType } from '@/features/chat/composer/composer-context-notice';
import { showActivity } from '@/stores/activity-store';

/**
 * Keep chat feedback beside the composer. Non-chat callers record persistent
 * feedback in the activity center until their owning surface handles it inline.
 * Supports `{{key}}` template interpolation.
 */
export function showComposerNotification(
  level: ComposerNoticeType,
  template: string,
  params?: Record<string, string | number>,
  options?: { duration?: number; href?: string },
): void {
  const message = params
    ? template.replace(/\{\{(\w+)\}\}/g, (_, key: string) => String(params[key] ?? ''))
    : template;

  const onChatRoute = typeof window !== 'undefined' && window.location.hash.replace(/^#/, '').startsWith('/chat');
  if (onChatRoute) {
    window.dispatchEvent(
      new CustomEvent<ComposerNoticeDetail>(COMPOSER_NOTICE_EVENT, {
        detail: {
          type: level,
          message,
          duration: options?.duration,
          href: options?.href,
        },
      }),
    );
    return;
  }

  showActivity({
    tone: level,
    title: message,
    href: options?.href,
    dedupeKey: `action-feedback:${level}:${message}`,
  });
}
