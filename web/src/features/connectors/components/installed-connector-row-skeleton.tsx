import { Skeleton } from '@/components/ui/skeleton';

export function InstalledConnectorRowSkeleton() {
  return (
    <div className="flex min-h-[8.75rem] min-w-0 flex-col rounded-xl border border-edge bg-surface-panel p-4" aria-hidden>
      <div className="flex items-start gap-3">
        <Skeleton className="size-9 shrink-0 rounded-lg" />
        <div className="min-w-0 flex-1 space-y-2">
          <Skeleton className="h-4 w-28 max-w-full" />
          <Skeleton className="h-3 w-20 max-w-full" />
        </div>
      </div>
      <Skeleton className="mt-2 h-3 w-48 max-w-full" />
      <Skeleton className="ml-auto mt-auto h-3 w-16" />
    </div>
  );
}
