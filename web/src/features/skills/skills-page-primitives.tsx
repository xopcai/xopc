import { cn } from '@/lib/cn';

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
