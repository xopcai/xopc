import { showActivity } from '@/stores/activity-center-store';

export type ToastType = 'info' | 'success' | 'warning' | 'error';

export type ToastDetail = {
  type?: ToastType;
  title: string;
  message?: string;
  /** Milliseconds before auto-dismiss; `0` keeps the toast until manually closed. */
  duration?: number;
  /** Optional activity metadata used when warning/error feedback is routed to history. */
  source?: string;
  href?: string;
  dedupeKey?: string;
};

/** Restrained transient-feedback channel used by AppShell `ToastHost`. */
export const TOAST_EVENT = 'extension-notification';

/** Maximum simultaneous toasts in the stack (oldest dropped when exceeded). */
export const TOAST_MAX_VISIBLE = 1;

export const TOAST_DEFAULT_DURATION_MS = 2500;

export function showToast(detail: ToastDetail): void {
  const title = detail.title?.trim();
  if (!title) return;
  const type = detail.type ?? 'info';
  if (type === 'error' || type === 'warning' || detail.duration === 0) {
    showActivity({
      tone: type,
      title,
      message: detail.message,
      source: detail.source,
      href: detail.href,
      dedupeKey:
        detail.dedupeKey ??
        `feedback:${type}:${title}:${detail.message?.trim() ?? ''}`,
    });
    return;
  }
  window.dispatchEvent(
    new CustomEvent(TOAST_EVENT, {
      detail: {
        type,
        title,
        message: detail.message,
        duration: detail.duration,
      },
    }),
  );
}
