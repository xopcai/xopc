import { Skeleton } from '@/components/ui/skeleton';

export function SettingsPageSkeleton({ sections = 2 }: { sections?: number }) {
  return (
    <div className="flex flex-col gap-6" aria-busy="true">
      <div className="space-y-2">
        <Skeleton className="h-6 w-48 max-w-full" />
        <Skeleton className="h-4 w-80 max-w-full" />
      </div>
      {Array.from({ length: sections }).map((_, sectionIndex) => (
        <section
          key={sectionIndex}
          className="rounded-2xl bg-surface-panel p-4 shadow-surface"
        >
          <Skeleton className="h-5 w-40 max-w-full" />
          <Skeleton className="mt-2 h-4 w-72 max-w-full" />
          <div className="mt-5 grid gap-4 sm:grid-cols-2">
            {Array.from({ length: 4 }).map((__, fieldIndex) => (
              <div key={fieldIndex} className="space-y-2">
                <Skeleton className="h-3 w-24" />
                <Skeleton className="h-10 w-full rounded-lg" />
              </div>
            ))}
          </div>
        </section>
      ))}
    </div>
  );
}
