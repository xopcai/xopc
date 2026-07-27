import { Skeleton } from '@/components/ui/skeleton';

export function SettingsPanelSkeleton({ rows = 3 }: { rows?: number }) {
  return (
    <div className="flex flex-col gap-3" aria-busy="true">
      {Array.from({ length: rows }).map((_, rowIndex) => (
        <div
          key={rowIndex}
          className="rounded-xl bg-surface-panel/70 p-3 shadow-surface"
        >
          <Skeleton className="h-4 w-40 max-w-full" />
          <Skeleton className="mt-2 h-3 w-64 max-w-full" />
        </div>
      ))}
    </div>
  );
}
