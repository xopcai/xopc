import { FolderInput } from 'lucide-react';

import { folderDisplayName } from '@/features/fs/directory-path-utils';
import { cn } from '@/lib/cn';
import { interaction } from '@/lib/interaction';

type Props = {
  value: string;
  onPick: () => void;
  disabled?: boolean;
  placeholder?: string;
  title?: string;
  className?: string;
  maxWidthClass?: string;
  /** Icon-only pick control for path-row layouts (full path shown in a separate input). */
  compact?: boolean;
  'aria-label'?: string;
};

export function DirectoryPickerTrigger({
  value,
  onPick,
  disabled,
  placeholder,
  title,
  className,
  maxWidthClass = 'max-w-[min(12rem,40vw)]',
  compact = false,
  'aria-label': ariaLabel,
}: Props) {
  const trimmed = value.trim();
  const label = trimmed ? folderDisplayName(trimmed) : (placeholder ?? '');

  return (
    <button
      type="button"
      disabled={disabled}
      title={title ?? (trimmed || undefined)}
      aria-label={ariaLabel ?? title ?? label}
      className={cn(
        compact
          ? 'inline-flex size-9 shrink-0 items-center justify-center rounded-lg p-0'
          : 'inline-flex min-h-8 min-w-0 shrink-0 items-center gap-1 rounded-lg px-2 py-1 text-xs',
        'border border-edge-subtle/80 bg-surface-hover/40 dark:border-edge-subtle',
        interaction.transition,
        interaction.focusRingPanel,
        'cursor-pointer hover:bg-surface-hover/70 dark:hover:bg-surface-hover/50',
        !compact && maxWidthClass,
        disabled && 'cursor-not-allowed opacity-60',
        className,
      )}
      onClick={(e) => {
        e.stopPropagation();
        if (!disabled) onPick();
      }}
    >
      <FolderInput className={cn('shrink-0 text-fg-muted', compact ? 'size-4' : 'size-3.5')} aria-hidden />
      {!compact ? <span className="min-w-0 truncate text-left font-medium text-fg">{label}</span> : null}
    </button>
  );
}
