import {
  Activity,
  AlertTriangle,
  Check,
  CheckCircle2,
  ChevronRight,
  CircleAlert,
  Clock3,
  Info,
  Loader2,
  Trash2,
  X,
} from 'lucide-react';
import { useEffect, useMemo, useState } from 'react';
import { Link } from 'react-router-dom';

import { Button } from '@/components/ui/button';
import { Skeleton } from '@/components/ui/skeleton';
import {
  checkActivityTarget,
  parseActivityTarget,
  type ActivityTargetAvailability,
} from '@/features/activity/activity-target';
import { messages } from '@/i18n/messages';
import { cn } from '@/lib/cn';
import { type ActivityItem, useActivityStore } from '@/stores/activity-store';
import { useLocaleStore } from '@/stores/locale-store';

const INITIAL_VISIBLE_ITEMS = 3;

const TONE_META = {
  info: { Icon: Info, className: 'text-accent-fg bg-accent-soft' },
  success: { Icon: CheckCircle2, className: 'text-success bg-success-soft' },
  warning: { Icon: AlertTriangle, className: 'text-warning bg-warning-soft' },
  error: { Icon: CircleAlert, className: 'text-danger bg-danger-soft' },
} as const;

function relativeTime(timestamp: number, language: 'en' | 'zh'): string {
  const seconds = Math.max(0, Math.round((Date.now() - timestamp) / 1000));
  if (seconds < 60) return language === 'zh' ? '刚刚' : 'Just now';
  const minutes = Math.round(seconds / 60);
  if (minutes < 60) return language === 'zh' ? `${minutes} 分钟前` : `${minutes}m ago`;
  const hours = Math.round(minutes / 60);
  if (hours < 24) return language === 'zh' ? `${hours} 小时前` : `${hours}h ago`;
  const days = Math.round(hours / 24);
  return language === 'zh' ? `${days} 天前` : `${days}d ago`;
}

function ActivityRow({
  item,
  targetAvailability,
}: {
  item: ActivityItem;
  targetAvailability: ActivityTargetAvailability;
}) {
  const language = useLocaleStore((state) => state.language);
  const copy = messages(language).projectsPage.home;
  const remove = useActivityStore((state) => state.remove);
  const { Icon, className } = TONE_META[item.tone];

  return (
    <article className="group flex items-start gap-3 border-t border-edge-subtle px-1 py-3 first:border-t-0">
      <div className={cn('mt-0.5 flex size-7 shrink-0 items-center justify-center rounded-lg', className)}>
        {item.status === 'running' ? (
          <Loader2 className="size-3.5 animate-spin motion-reduce:animate-none" aria-hidden />
        ) : (
          <Icon className="size-3.5" aria-hidden />
        )}
      </div>
      <div className="min-w-0 flex-1">
        <div className="flex min-w-0 items-start gap-2">
          <h3 className="min-w-0 flex-1 text-sm font-medium leading-5 text-fg">{item.title}</h3>
          {!item.read ? <span className="mt-1.5 size-1.5 shrink-0 rounded-full bg-accent" aria-label={copy.activityUnread} /> : null}
        </div>
        {item.message ? <p className="mt-0.5 line-clamp-2 text-xs leading-5 text-fg-muted">{item.message}</p> : null}
        <div className="mt-1.5 flex min-w-0 flex-wrap items-center gap-x-2 text-[11px] text-fg-subtle">
          {item.source ? <span className="max-w-48 truncate">{item.source}</span> : null}
          <span>{relativeTime(item.updatedAt, language)}</span>
          {item.occurrences > 1 ? <span>×{item.occurrences}</span> : null}
          {item.href && targetAvailability === 'available' ? (
            <Link
              to={item.href}
              className="inline-flex items-center gap-0.5 font-medium text-accent-fg hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent"
            >
              {copy.activityViewRelated}
              <ChevronRight className="size-3" aria-hidden />
            </Link>
          ) : item.href && targetAvailability === 'checking' ? (
            <Skeleton className="h-3 w-20 rounded" aria-label={copy.activityCheckingRelated} />
          ) : item.href && targetAvailability === 'missing' ? (
            <span className="font-medium text-fg-subtle" role="status">
              {copy.activityRelatedMissing}
            </span>
          ) : null}
        </div>
      </div>
      <button
        type="button"
        className="rounded-md p-1 text-fg-subtle opacity-0 transition-opacity hover:bg-surface-hover hover:text-fg group-hover:opacity-100 focus:opacity-100 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent"
        aria-label={copy.activityRemove}
        onClick={() => remove(item.id)}
      >
        <X className="size-3.5" aria-hidden />
      </button>
    </article>
  );
}

export function WorkbenchActivity() {
  const language = useLocaleStore((state) => state.language);
  const copy = messages(language).projectsPage.home;
  const items = useActivityStore((state) => state.items);
  const markAllRead = useActivityStore((state) => state.markAllRead);
  const clearFinished = useActivityStore((state) => state.clearFinished);
  const [expanded, setExpanded] = useState(false);
  const [targetAvailability, setTargetAvailability] = useState<Record<string, ActivityTargetAvailability>>({});
  const runningCount = useMemo(() => items.filter((item) => item.status === 'running').length, [items]);
  const unreadCount = useMemo(() => items.filter((item) => !item.read).length, [items]);
  const visibleItems = expanded ? items : items.slice(0, INITIAL_VISIBLE_ITEMS);
  const targetKey = useMemo(() => [...new Set(items.flatMap((item) => (
    item.href && parseActivityTarget(item.href) ? [item.href] : []
  )))].sort().join('\n'), [items]);

  useEffect(() => {
    const controller = new AbortController();
    const targets = new Map(
      (targetKey ? targetKey.split('\n') : []).flatMap((href) => {
        const target = parseActivityTarget(href);
        return target ? [[href, target] as const] : [];
      }),
    );
    setTargetAvailability(Object.fromEntries([...targets.keys()].map((href) => [href, 'checking'])));
    void Promise.all(
      [...targets].map(async ([href, target]) => {
        const availability = await checkActivityTarget(target, controller.signal);
        if (controller.signal.aborted) return;
        setTargetAvailability((current) => ({ ...current, [href]: availability }));
      }),
    ).catch(() => undefined);
    return () => controller.abort();
  }, [targetKey]);

  return (
    <section className="rounded-2xl bg-surface-base p-4 shadow-surface" aria-labelledby="workbench-activity-title">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <div className="flex items-center gap-2">
            <Activity className="size-4 text-fg-subtle" aria-hidden />
            <h2 id="workbench-activity-title" className="text-sm font-semibold text-fg">{copy.activityTitle}</h2>
            {runningCount > 0 ? (
              <span className="inline-flex items-center gap-1.5 rounded-full bg-accent-soft px-2 py-0.5 text-[11px] font-medium text-accent-fg">
                <Loader2 className="size-3 animate-spin motion-reduce:animate-none" aria-hidden />
                {runningCount} {copy.running}
              </span>
            ) : unreadCount > 0 ? (
              <span className="rounded-full bg-surface-panel px-2 py-0.5 text-[11px] font-medium text-fg-muted">
                {unreadCount} {copy.activityNew}
              </span>
            ) : null}
          </div>
        </div>
        {expanded && items.length > 0 ? (
          <div className="flex items-center gap-1">
            {unreadCount > 0 ? (
              <Button type="button" variant="ghost" className="h-8 px-2 text-xs" onClick={markAllRead}>
                <Check className="size-3.5" aria-hidden />
                {copy.activityMarkRead}
              </Button>
            ) : null}
            {items.some((item) => item.status === 'done') ? (
              <Button type="button" variant="ghost" className="h-8 px-2 text-xs text-fg-muted" onClick={clearFinished}>
                <Trash2 className="size-3.5" aria-hidden />
                {copy.activityClearFinished}
              </Button>
            ) : null}
          </div>
        ) : null}
      </div>

      {items.length > 0 ? (
        <div className="mt-3 px-1">
          {visibleItems.map((item) => (
            <ActivityRow
              key={item.id}
              item={item}
              targetAvailability={item.href && parseActivityTarget(item.href)
                ? (targetAvailability[item.href] ?? 'checking')
                : 'available'}
            />
          ))}
          {items.length > INITIAL_VISIBLE_ITEMS ? (
            <div className="border-t border-edge-subtle py-2 text-center">
              <Button type="button" variant="ghost" className="h-8 px-2 text-xs" onClick={() => setExpanded((value) => !value)}>
                {expanded ? copy.activityShowLess : copy.activityShowAll.replace('{{count}}', String(items.length))}
              </Button>
            </div>
          ) : null}
        </div>
      ) : (
        <div className="mt-3 flex items-center gap-2 text-sm text-fg-muted">
          <Clock3 className="size-4 text-fg-subtle" aria-hidden />
          <p>{copy.activityEmpty}</p>
        </div>
      )}
    </section>
  );
}
