import { cn } from '@/lib/cn';

const connectorSkeletonBar =
  'animate-pulse motion-reduce:animate-none rounded-md bg-surface-hover dark:bg-surface-active/50';

export function InstalledConnectorRowSkeleton() {
  return (
    <div
      className="rounded-2xl bg-surface-panel p-4 shadow-surface"
      aria-hidden
    >
      <div className="flex items-start gap-3">
        <div
          className={cn('size-10 shrink-0 rounded-xl', connectorSkeletonBar)}
        />
        <div className="flex min-w-0 flex-1 flex-wrap items-start justify-between gap-3">
          <div className="min-w-0 flex-1 space-y-2">
            <div
              className={cn('h-4 w-48 max-w-full', connectorSkeletonBar)}
            />
            <div
              className={cn('h-3 w-72 max-w-full', connectorSkeletonBar)}
            />
          </div>
          <div className="flex shrink-0 gap-2">
            <div
              className={cn('h-9 w-20 rounded-lg', connectorSkeletonBar)}
            />
            <div
              className={cn('h-9 w-20 rounded-lg', connectorSkeletonBar)}
            />
          </div>
        </div>
      </div>
      <div className="mt-4 flex flex-wrap gap-2">
        <div className={cn('h-8 w-20 rounded-md', connectorSkeletonBar)} />
        <div className={cn('h-8 w-24 rounded-md', connectorSkeletonBar)} />
        <div className={cn('h-8 w-28 rounded-md', connectorSkeletonBar)} />
      </div>
      <div className={cn('mt-3 h-20 rounded-xl', connectorSkeletonBar)} />
    </div>
  );
}
