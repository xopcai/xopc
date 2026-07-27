import { cn } from '@/lib/cn';

const connectorSkeletonBar =
  'animate-pulse motion-reduce:animate-none rounded-md bg-surface-hover dark:bg-surface-active/50';

export function ConnectorCardSkeleton() {
  return (
    <div
      className="flex h-full min-h-[9.5rem] flex-col rounded-xl bg-surface-panel p-4 shadow-surface"
      aria-hidden
    >
      <div className="flex min-h-0 flex-1 items-start gap-3">
        <div
          className={cn('size-10 shrink-0 rounded-xl', connectorSkeletonBar)}
        />
        <div className="flex min-w-0 flex-1 flex-col gap-2">
          <div className="flex items-start justify-between gap-2">
            <div
              className={cn('h-4 min-w-0 flex-1', connectorSkeletonBar)}
            />
            <div
              className={cn(
                'h-8 w-[4.5rem] shrink-0 rounded-lg',
                connectorSkeletonBar,
              )}
            />
          </div>
          <div className={cn('h-3 w-full', connectorSkeletonBar)} />
          <div className={cn('h-3 w-[88%]', connectorSkeletonBar)} />
        </div>
      </div>
    </div>
  );
}
