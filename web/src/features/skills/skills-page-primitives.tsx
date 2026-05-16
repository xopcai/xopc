import { cn } from '@/lib/cn';

export function SkillEnableSwitch({
  checked,
  onChange,
}: {
  checked: boolean;
  onChange: (next: boolean) => void;
}) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={checked}
      className={cn(
        'relative h-6 w-10 shrink-0 overflow-hidden rounded-full border border-edge p-0.5',
        'transition-[border-color,background-color] duration-200 ease-out',
        'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent focus-visible:ring-offset-2 focus-visible:ring-offset-surface-base',
        'active:scale-[0.97] motion-reduce:transition-none motion-reduce:active:scale-100',
        checked ? 'bg-accent' : 'bg-surface-hover',
      )}
      onClick={() => onChange(!checked)}
    >
      <span
        className={cn(
          'pointer-events-none absolute left-0.5 top-1/2 block size-4 -translate-y-1/2 rounded-full bg-surface-panel shadow-surface ring-1 ring-edge/40 dark:ring-edge/55',
          'transition-transform duration-200 ease-out motion-reduce:transition-none',
          checked ? 'translate-x-5' : 'translate-x-0',
        )}
        aria-hidden
      />
    </button>
  );
}

const skelBar =
  'animate-pulse motion-reduce:animate-none rounded-md bg-surface-hover dark:bg-surface-active/50';

/** Matches marketplace skill cards (title row actions + meta). */
export function MarketplaceSkillCardSkeleton() {
  return (
    <div
      className="flex h-full min-h-[10.5rem] flex-col rounded-xl border border-edge-subtle bg-surface-base p-4 dark:border-edge-subtle"
      aria-hidden
    >
      <div className="flex min-h-0 flex-1 items-start gap-3">
        <div className={cn('size-11 shrink-0 rounded-xl', skelBar)} />
        <div className="flex min-w-0 flex-1 flex-col gap-2">
          <div className="flex items-start justify-between gap-2">
            <div className={cn('h-4 min-w-0 flex-1', skelBar)} />
            <div className="flex shrink-0 gap-1">
              <div className={cn('size-8 shrink-0 rounded-lg', skelBar)} />
              <div className={cn('h-8 w-[4.5rem] shrink-0 rounded-lg', skelBar)} />
            </div>
          </div>
          <div className={cn('h-3 w-full', skelBar)} />
          <div className={cn('h-3 w-[92%]', skelBar)} />
          <div className="mt-auto space-y-1 pt-0.5">
            <div className={cn('h-3 w-full', skelBar)} />
            <div className={cn('h-2.5 w-4/5', skelBar)} />
          </div>
        </div>
      </div>
    </div>
  );
}

/** Matches built-in / user skill cards (title-row actions, same as marketplace). */
export function SkillCatalogCardSkeleton() {
  return <MarketplaceSkillCardSkeleton />;
}
