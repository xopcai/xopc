import { cn } from '@/lib/cn';

const skelBar =
  'animate-pulse motion-reduce:animate-none rounded-md bg-surface-hover dark:bg-surface-active/50';

/** Matches the compact icon, title, action, description, and source layout. */
export function MarketplaceSkillCardSkeleton() {
  return (
    <div
      className="flex min-w-0 flex-col gap-3 rounded-lg border border-edge bg-surface-panel p-4"
      aria-hidden
    >
      <div className="flex h-8 items-center gap-2">
        <div className={cn('size-7 shrink-0', skelBar)} />
        <div className={cn('h-4 min-w-0 flex-1', skelBar)} />
        <div className={cn('h-8 w-12 shrink-0', skelBar)} />
      </div>
      <div className="flex flex-col gap-2">
        <div className="flex h-5 items-center"><div className={cn('h-3 w-full', skelBar)} /></div>
        <div className="flex h-4 items-center"><div className={cn('h-3 w-16', skelBar)} /></div>
      </div>
    </div>
  );
}

/** Matches built-in / user skill cards (title-row actions, same as marketplace). */
export function SkillCatalogCardSkeleton() {
  return <MarketplaceSkillCardSkeleton />;
}
