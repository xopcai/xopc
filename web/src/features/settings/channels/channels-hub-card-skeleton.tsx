import { cn } from '@/lib/cn';

const skelBar =
  'animate-pulse motion-reduce:animate-none rounded-md bg-surface-hover dark:bg-surface-active/50';

/** Matches `ChannelHubCard` layout (icon + status + summary + CTA row). */
export function ChannelHubCardSkeleton() {
  return (
    <div
      className="flex h-full min-h-[15.5rem] flex-col gap-3 rounded-xl border border-edge-subtle bg-surface-panel p-4 shadow-sm dark:border-edge-subtle"
      aria-hidden
    >
      <div className="flex items-start justify-between gap-3">
        <div className={cn('size-11 shrink-0 rounded-xl', skelBar)} />
        <div className={cn('h-6 w-10 shrink-0 rounded-full', skelBar)} />
      </div>
      <div className="space-y-2">
        <div className={cn('h-4 w-2/5', skelBar)} />
        <div className={cn('h-5 w-16 rounded-full', skelBar)} />
        <div className={cn('h-3 w-full', skelBar)} />
        <div className={cn('h-3 w-[88%]', skelBar)} />
        <div className={cn('h-3 w-3/5', skelBar)} />
      </div>
      <div className="mt-auto flex gap-2">
        <div className={cn('h-10 min-w-0 flex-1 rounded-lg', skelBar)} />
        <div className={cn('size-9 shrink-0 rounded-lg', skelBar)} />
      </div>
    </div>
  );
}

export function ChannelsHubGridSkeleton({ count = 3 }: { count?: number }) {
  return (
    <ul className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3" role="list" aria-busy>
      {Array.from({ length: count }, (_, i) => (
        <li key={i} className="h-full min-h-0">
          <ChannelHubCardSkeleton />
        </li>
      ))}
    </ul>
  );
}
