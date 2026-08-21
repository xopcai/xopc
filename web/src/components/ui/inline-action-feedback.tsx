import { AlertCircle, CheckCircle2, Info, TriangleAlert } from 'lucide-react';

import { cn } from '@/lib/cn';

export type ActionFeedback = {
  tone: 'info' | 'success' | 'warning' | 'error';
  title: string;
  message?: string;
};

const variants = {
  info: { Icon: Info, className: 'border-accent/25 bg-accent-soft text-fg' },
  success: { Icon: CheckCircle2, className: 'border-success/25 bg-success-soft text-fg' },
  warning: { Icon: TriangleAlert, className: 'border-warning/30 bg-warning-soft text-fg' },
  error: { Icon: AlertCircle, className: 'border-danger/25 bg-danger-soft text-danger' },
} as const;

/** Persistent feedback rendered beside the control or surface that initiated an action. */
export function InlineActionFeedback({
  feedback,
  className,
}: {
  feedback: ActionFeedback | null;
  className?: string;
}) {
  if (!feedback) return null;
  const { Icon, className: variantClassName } = variants[feedback.tone];
  return (
    <div
      className={cn('flex items-start gap-2 rounded-lg border px-3 py-2 text-sm', variantClassName, className)}
      role={feedback.tone === 'error' ? 'alert' : 'status'}
      aria-live={feedback.tone === 'error' ? 'assertive' : 'polite'}
    >
      <Icon className="mt-0.5 size-4 shrink-0" aria-hidden />
      <div className="min-w-0">
        <p className="font-medium">{feedback.title}</p>
        {feedback.message ? <p className="mt-0.5 text-xs opacity-80">{feedback.message}</p> : null}
      </div>
    </div>
  );
}
