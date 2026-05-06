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

export function SkillListRowSkeleton() {
  const skel =
    'animate-pulse motion-reduce:animate-none rounded-md bg-surface-hover dark:bg-surface-active/50';
  return (
    <div className="flex items-center gap-4 px-4 py-3.5" aria-hidden>
      <div className={cn('size-11 shrink-0 rounded-xl', skel)} />
      <div className="min-w-0 flex-1 space-y-2">
        <div className={cn('h-4 max-w-[10rem]', skel)} />
        <div className={cn('h-3 w-full max-w-xl rounded', skel)} />
      </div>
      <div className={cn('h-6 w-10 shrink-0 rounded-full', skel)} />
    </div>
  );
}

/** Taller row — matches marketplace cards (meta pills + install button) to avoid layout jump after fetch. */
export function MarketplaceSkillListRowSkeleton() {
  const skel =
    'animate-pulse motion-reduce:animate-none rounded-md bg-surface-hover dark:bg-surface-active/50';
  return (
    <div className="flex items-center gap-4 px-4 py-3.5" aria-hidden>
      <div className={cn('size-11 shrink-0 rounded-xl', skel)} />
      <div className="min-w-0 flex-1 space-y-2 pr-2">
        <div className={cn('h-4 max-w-[12rem]', skel)} />
        <div className={cn('h-3 w-full max-w-xl rounded', skel)} />
        <div className="flex flex-wrap gap-1.5 pt-0.5">
          <div className={cn('h-5 w-[5.5rem] rounded-md', skel)} />
          <div className={cn('h-5 w-16 rounded-md', skel)} />
          <div className={cn('h-5 w-14 rounded-md', skel)} />
        </div>
      </div>
      <div className={cn('h-9 min-w-[6.5rem] shrink-0 rounded-lg', skel)} />
    </div>
  );
}
