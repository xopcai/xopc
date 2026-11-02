import { ArrowUpRight, Check } from 'lucide-react';

import { Button } from '@/components/ui/button';
import { cn } from '@/lib/cn';

type Props = {
  label: string;
  description?: string;
  index: number;
  recommended?: boolean;
  recommendedLabel: string;
  selected?: boolean;
  disabled?: boolean;
  onClick: () => void;
};

export function ClarificationChoice({ label, description, index, recommended, recommendedLabel, selected, disabled, onClick }: Props) {
  return <Button variant="ghost" disabled={disabled} onClick={onClick} aria-pressed={Boolean(selected)}
    className={cn('group min-h-11 w-full justify-start gap-3 rounded-md px-3 py-2.5 text-left font-normal text-fg shadow-none', selected && 'bg-accent-soft')}>
    <span aria-hidden="true" className={cn('flex size-6 shrink-0 items-center justify-center rounded-md border border-edge text-xs tabular-nums text-fg-muted', selected && 'border-accent text-accent-fg')}>
      {selected ? <Check className="size-3.5" /> : index + 1}
    </span>
    <span className="min-w-0 flex-1 whitespace-normal break-words">
      <span className="flex flex-wrap items-baseline gap-x-2 gap-y-0.5"><span className="font-medium">{label}</span>
        {recommended ? <span className="text-xs font-normal text-fg-muted">{recommendedLabel}</span> : null}</span>
      {description ? <span className="mt-0.5 block text-xs leading-relaxed text-fg-muted">{description}</span> : null}
    </span>
    <ArrowUpRight aria-hidden="true" className="size-4 shrink-0 text-fg-muted opacity-0 group-hover:opacity-100 group-focus-visible:opacity-100 motion-reduce:transition-none" />
  </Button>;
}
