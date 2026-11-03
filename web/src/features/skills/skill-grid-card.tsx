import { BriefcaseBusiness, Code2, FileText, Layers, Palette, Wrench } from 'lucide-react';
import { useId, type ReactNode } from 'react';

import { CapabilityIcon } from '@/features/capabilities/capability-icon';
import { cn } from '@/lib/cn';
import { interaction } from '@/lib/interaction';

const categoryIcons = {
  business: BriefcaseBusiness,
  creative: Palette,
  documents: FileText,
  engineering: Code2,
  tools: Wrench,
};

export const skillCardActionClassName =
  'h-8 shrink-0 whitespace-nowrap rounded-md px-2.5 py-1 text-xs font-medium shadow-none sm:shadow-none';

export function SkillGridCard({
  name,
  description,
  category,
  iconUrl,
  action,
  metadata,
  onOpen,
}: {
  name: string;
  description: string;
  category?: string;
  iconUrl?: string;
  action: ReactNode;
  metadata: ReactNode;
  onOpen: () => void;
}) {
  const titleId = useId();
  const Icon = categoryIcons[category as keyof typeof categoryIcons] ?? Layers;

  return (
    <article className="flex min-w-0 flex-col gap-3 rounded-lg border border-edge bg-surface-panel p-4 transition-colors hover:bg-surface-hover/40 motion-reduce:transition-none [content-visibility:auto] [contain-intrinsic-size:auto_128px]">
      <div className="flex min-w-0 items-center gap-2">
        <CapabilityIcon
          iconUrl={iconUrl}
          fallback={Icon}
          className="size-7 rounded-md bg-surface-inset [&_svg]:size-4"
        />
        <h3 id={titleId} className="min-w-0 flex-1 text-sm font-medium tracking-tight text-fg">
          <button
            type="button"
            className={cn('block w-full truncate rounded-md text-left', interaction.focusRingPanel)}
            title={name}
            onClick={onOpen}
          >
            {name}
          </button>
        </h3>
        {action}
      </div>
      <button
        type="button"
        className={cn('flex min-w-0 flex-1 flex-col gap-2 rounded-md text-left', interaction.focusRingPanel)}
        aria-labelledby={titleId}
        onClick={onOpen}
      >
        <p className="w-full truncate text-sm leading-5 text-fg-muted" title={description || undefined}>
          {description || '—'}
        </p>
        <span className="mt-auto block w-full truncate text-xs leading-4 text-fg-muted">
          {metadata}
        </span>
      </button>
    </article>
  );
}
