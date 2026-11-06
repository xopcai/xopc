import { cn } from '@/lib/cn';

export function TaskHeaderTitle({ label, title, compact }: { label: string; title?: string; compact: boolean }) {
  const showTitle = compact && Boolean(title);
  const motion = 'truncate [grid-area:1/1] motion-safe:transition-[opacity,translate] motion-safe:duration-200 motion-safe:ease-out';
  return <span className="grid min-w-0 overflow-hidden leading-6" data-task-header-compact={showTitle}>
    <span aria-hidden={showTitle} className={cn(motion, showTitle && '-translate-y-2 opacity-0')}>{label}</span>
    <span aria-hidden={!showTitle} className={cn(motion, !showTitle && 'translate-y-2 opacity-0')}>{title}</span>
  </span>;
}
