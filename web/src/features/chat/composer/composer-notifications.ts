import { COMPOSER_NOTICE_EVENT, type ComposerNoticeDetail } from '@/features/chat/composer/composer-context-notice';
import { showToast, type ToastType } from '@/lib/toast';

/**
 * Keep chat feedback beside the composer. Non-chat callers retain a restrained
 * transient fallback until they adopt control-level feedback.
 * Supports `{{key}}` template interpolation.
 */
export function showComposerNotification(
  level: ToastType,
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

  showToast({ type: level, title: message, duration: options?.duration ?? 2500 });
}
