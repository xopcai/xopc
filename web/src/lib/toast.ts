export type ToastType = 'info' | 'success' | 'warning' | 'error';

export type ToastDetail = {
  type?: ToastType;
  title: string;
  message?: string;
  /** Milliseconds before auto-dismiss; `0` keeps the toast until manually closed. */
  duration?: number;
};

/** Global toast channel used by AppShell `ToastHost` and extension iframe bridge. */
export const TOAST_EVENT = 'extension-notification';

/** Maximum simultaneous toasts in the stack (oldest dropped when exceeded). */
export const TOAST_MAX_VISIBLE = 3;

export const TOAST_DEFAULT_DURATION_MS = 5000;

export function showToast(detail: ToastDetail): void {
  const title = detail.title?.trim();
  if (!title) return;
  window.dispatchEvent(
    new CustomEvent(TOAST_EVENT, {
      detail: {
        type: detail.type ?? 'info',
        title,
        message: detail.message,
        duration: detail.duration,
      },
    }),
  );
}
