import { Plus } from 'lucide-react';

import { Button } from '@/components/ui/button';
import { cn } from '@/lib/cn';

export const sidebarSectionLabelClass = 'text-xs font-normal leading-5 text-fg-subtle';

export function SidebarCreateSectionHeader({ label, createLabel, onCreate, disabled, current, className }: {
  label: string;
  createLabel: string;
  onCreate: () => void;
  disabled?: boolean;
  current?: boolean;
  className?: string;
}) {
  return (
    <div className={cn('flex items-center justify-between px-4 pb-0.5', className)}>
      <h2 className={sidebarSectionLabelClass}>{label}</h2>
      <Button
        variant="ghost"
        className={cn('size-7 shrink-0 rounded-md p-0', current && 'bg-surface-active text-fg')}
        aria-label={createLabel}
        aria-current={current ? 'page' : undefined}
        title={createLabel}
        disabled={disabled}
        onClick={onCreate}
      >
        <Plus className="size-3.5" strokeWidth={2} aria-hidden />
      </Button>
    </div>
  );
}
