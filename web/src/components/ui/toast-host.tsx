import { AlertCircle, CheckCircle2, Info, TriangleAlert, X } from 'lucide-react';
import { useCallback, useEffect, useRef, useState } from 'react';

import { cn } from '@/lib/cn';
import {
  TOAST_DEFAULT_DURATION_MS,
  TOAST_EVENT,
  TOAST_MAX_VISIBLE,
  type ToastDetail,
  type ToastType,
} from '@/lib/toast';
import { useLocaleStore } from '@/stores/locale-store';

type ActiveToast = ToastDetail & { id: number };

const TOAST_VARIANT: Record<
  ToastType,
  { Icon: typeof Info; stripe: string; icon: string }
> = {
  success: {
    Icon: CheckCircle2,
    stripe: 'border-l-success',
    icon: 'text-success',
  },
  error: {
    Icon: AlertCircle,
    stripe: 'border-l-danger',
    icon: 'text-danger',
  },
  warning: {
    Icon: TriangleAlert,
    stripe: 'border-l-warning',
    icon: 'text-warning',
  },
  info: {
    Icon: Info,
    stripe: 'border-l-accent',
    icon: 'text-accent-fg',
  },
};

function parseToastDetail(detail: ToastDetail | undefined): ToastDetail | null {
  if (!detail || typeof detail.title !== 'string') return null;
  const title = detail.title.trim();
  if (!title) return null;
  return {
    type: detail.type ?? 'info',
    title,
    message: typeof detail.message === 'string' ? detail.message : undefined,
    duration: detail.duration,
  };
}

function ToastItem({
  toast,
  dismissLabel,
  onDismiss,
}: {
  toast: ActiveToast;
  dismissLabel: string;
  onDismiss: (id: number) => void;
}) {
  const type = toast.type ?? 'info';
  const { Icon, stripe, icon } = TOAST_VARIANT[type];

  return (
    <div
      className={cn(
        'toast-enter pointer-events-auto flex w-full max-w-md items-start gap-3 rounded-xl border border-edge border-l-[3px] bg-surface-panel px-3.5 py-3 text-sm shadow-popover',
        stripe,
      )}
      role="status"
      aria-live="polite"
    >
      <Icon className={cn('mt-0.5 size-4 shrink-0', icon)} aria-hidden />
      <div className="min-w-0 flex-1">
        <div className="font-medium text-fg">{toast.title}</div>
        {toast.message ? <div className="mt-0.5 text-fg-muted">{toast.message}</div> : null}
      </div>
      <button
        type="button"
        className="shrink-0 rounded-md p-1 text-fg-subtle transition-colors hover:bg-surface-hover hover:text-fg focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent"
        aria-label={dismissLabel}
        onClick={() => onDismiss(toast.id)}
      >
        <X className="size-4" aria-hidden />
      </button>
    </div>
  );
}

/**
 * Global transient surface. Persistent and actionable feedback belongs in the
 * activity center or the local task surface.
 */
export function ToastHost() {
  const language = useLocaleStore((s) => s.language);
  const dismissLabel = language === 'zh' ? '关闭' : 'Dismiss';
  const [toasts, setToasts] = useState<ActiveToast[]>([]);
  const nextIdRef = useRef(0);
  const dismissTimersRef = useRef<Map<number, number>>(new Map());

  const clearDismissTimer = useCallback((id: number) => {
    const timer = dismissTimersRef.current.get(id);
    if (timer != null) {
      window.clearTimeout(timer);
      dismissTimersRef.current.delete(id);
    }
  }, []);

  const dismiss = useCallback(
    (id: number) => {
      clearDismissTimer(id);
      setToasts((current) => current.filter((t) => t.id !== id));
    },
    [clearDismissTimer],
  );

  const scheduleDismiss = useCallback(
    (id: number, ms: number) => {
      clearDismissTimer(id);
      const timer = window.setTimeout(() => dismiss(id), ms);
      dismissTimersRef.current.set(id, timer);
    },
    [clearDismissTimer, dismiss],
  );

  const evictTimers = useCallback((keptIds: Set<number>) => {
    for (const [id, timer] of dismissTimersRef.current) {
      if (!keptIds.has(id)) {
        window.clearTimeout(timer);
        dismissTimersRef.current.delete(id);
      }
    }
  }, []);

  useEffect(() => {
    const handler = (e: Event) => {
      const parsed = parseToastDetail((e as CustomEvent<ToastDetail>).detail);
      if (!parsed) return;

      const id = ++nextIdRef.current;
      setToasts((current) => {
        const next = [{ ...parsed, id }, ...current].slice(0, TOAST_MAX_VISIBLE);
        evictTimers(new Set(next.map((t) => t.id)));
        return next;
      });

      const ms = parsed.duration === 0 ? 0 : (parsed.duration ?? TOAST_DEFAULT_DURATION_MS);
      if (ms > 0) {
        scheduleDismiss(id, ms);
      }
    };

    window.addEventListener(TOAST_EVENT, handler);
    return () => {
      window.removeEventListener(TOAST_EVENT, handler);
      for (const timer of dismissTimersRef.current.values()) {
        window.clearTimeout(timer);
      }
      dismissTimersRef.current.clear();
    };
  }, [evictTimers, scheduleDismiss]);

  if (toasts.length === 0) return null;

  return (
    <div
      className="pointer-events-none fixed inset-x-0 z-[100] flex justify-center px-4"
      style={{ top: 'max(var(--toast-top-inset, 0.75rem), env(safe-area-inset-top))' }}
    >
      <div className="flex w-full max-w-sm flex-col gap-2">
        {toasts.map((toast) => (
          <ToastItem key={toast.id} toast={toast} dismissLabel={dismissLabel} onDismiss={dismiss} />
        ))}
      </div>
    </div>
  );
}
