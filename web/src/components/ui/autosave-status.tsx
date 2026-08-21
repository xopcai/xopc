import { AlertCircle, Check, Loader2 } from 'lucide-react';

import type { AutosaveStatus as AutosaveState } from '@/lib/use-autosave';
import { cn } from '@/lib/cn';
import { useLocaleStore } from '@/stores/locale-store';

export function AutosaveStatus({ status, error, className }: {
  status: AutosaveState;
  error?: string | null;
  className?: string;
}) {
  const zh = useLocaleStore((state) => state.language) === 'zh';
  const label = status === 'saving'
    ? (zh ? '正在保存…' : 'Saving…')
    : status === 'saved'
      ? (zh ? '已自动保存' : 'Saved automatically')
      : status === 'error'
        ? (error || (zh ? '自动保存失败' : 'Autosave failed'))
        : status === 'dirty'
          ? (zh ? '编辑中，将自动保存' : 'Editing — autosave pending')
          : (zh ? '自动保存' : 'Autosave');

  return (
    <span
      className={cn(
        'inline-flex min-w-0 items-center gap-1.5 text-xs',
        status === 'error' ? 'text-danger' : status === 'saved' ? 'text-success' : 'text-fg-subtle',
        className,
      )}
      role="status"
      aria-live="polite"
      title={label}
    >
      {status === 'saving' ? <Loader2 className="size-3.5 shrink-0 animate-spin" aria-hidden /> : null}
      {status === 'saved' ? <Check className="size-3.5 shrink-0" aria-hidden /> : null}
      {status === 'error' ? <AlertCircle className="size-3.5 shrink-0" aria-hidden /> : null}
      {status === 'dirty' ? <span className="size-1.5 shrink-0 rounded-full bg-current" aria-hidden /> : null}
      <span className="truncate">{label}</span>
    </span>
  );
}
