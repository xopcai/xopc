import { Skeleton } from '@/components/ui/skeleton';

export function SettingsListSkeleton({ rows = 3 }: { rows?: number }) {
  return (
    <div className="flex flex-col gap-2.5" aria-busy="true">
      {Array.from({ length: rows }).map((_, rowIndex) => (
        <div
          key={rowIndex}
          className="rounded-xl bg-surface-panel/70 px-3 py-2.5 shadow-surface"
        >
          <Skeleton className="h-4 w-48 max-w-full" />
          <Skeleton className="mt-2 h-3 w-72 max-w-full" />
        </div>
      ))}
    </div>
  );
}
