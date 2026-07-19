import * as Dialog from '@radix-ui/react-dialog';
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
import { useMemo } from 'react';
import { useNavigate } from 'react-router-dom';

import { Button } from '@/components/ui/button';
import { cn } from '@/lib/cn';
import { useLocaleStore } from '@/stores/locale-store';
import {
  type ActivityItem,
  useActivityCenterStore,
} from '@/stores/activity-center-store';

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

function ActivityRow({ item, onOpen }: { item: ActivityItem; onOpen: (item: ActivityItem) => void }) {
  const language = useLocaleStore((s) => s.language);
  const remove = useActivityCenterStore((s) => s.remove);
  const { Icon, className } = TONE_META[item.tone];
  const canOpen = Boolean(item.href);

  return (
    <article className="group relative border-b border-edge-subtle px-4 py-3.5 last:border-b-0">
      <div className="flex items-start gap-3">
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
            {!item.read ? <span className="mt-1.5 size-1.5 shrink-0 rounded-full bg-accent" aria-label={language === 'zh' ? '未读' : 'Unread'} /> : null}
          </div>
          {item.message ? <p className="mt-0.5 line-clamp-2 text-xs leading-5 text-fg-muted">{item.message}</p> : null}
          <div className="mt-2 flex min-w-0 items-center gap-2 text-[11px] text-fg-subtle">
            {item.source ? <span className="truncate">{item.source}</span> : null}
            {item.source ? <span aria-hidden>·</span> : null}
            <span className="shrink-0">{relativeTime(item.updatedAt, language)}</span>
            {item.occurrences > 1 ? <span className="shrink-0">×{item.occurrences}</span> : null}
          </div>
          {canOpen ? (
            <button
              type="button"
              className="mt-2 inline-flex items-center gap-1 text-xs font-medium text-accent-fg hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent"
              onClick={() => onOpen(item)}
            >
              {language === 'zh' ? '查看相关内容' : 'View related'}
              <ChevronRight className="size-3.5" aria-hidden />
            </button>
          ) : null}
        </div>
        <button
          type="button"
          className="rounded-md p-1 text-fg-subtle opacity-0 transition-opacity hover:bg-surface-hover hover:text-fg group-hover:opacity-100 focus:opacity-100 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent"
          aria-label={language === 'zh' ? '移除活动' : 'Remove activity'}
          onClick={() => remove(item.id)}
        >
          <X className="size-3.5" aria-hidden />
        </button>
      </div>
    </article>
  );
}

export function ActivityCenterTrigger() {
  const language = useLocaleStore((s) => s.language);
  const open = useActivityCenterStore((s) => s.open);
  const setOpen = useActivityCenterStore((s) => s.setOpen);
  const items = useActivityCenterStore((s) => s.items);
  const unreadAttention = items.filter((item) => !item.read && (item.status === 'failed' || item.status === 'attention')).length;
  const running = items.filter((item) => item.status === 'running').length;
  const label = language === 'zh' ? '活动' : 'Activity';

  return (
    <button
      type="button"
      className={cn(
        'relative inline-flex h-8 items-center gap-2 rounded-lg border px-2.5 text-xs font-medium transition-colors',
        open
          ? 'border-accent/40 bg-accent-soft text-accent-fg'
          : 'border-edge-subtle bg-surface-panel text-fg-muted hover:bg-surface-hover hover:text-fg',
      )}
      aria-label={label}
      aria-expanded={open}
      onClick={() => setOpen(!open)}
    >
      {running > 0 ? <Loader2 className="size-3.5 animate-spin motion-reduce:animate-none" aria-hidden /> : <Activity className="size-3.5" aria-hidden />}
      <span className="hidden xl:inline">{running > 0 ? (language === 'zh' ? `${running} 项运行中` : `${running} running`) : label}</span>
      {unreadAttention > 0 ? (
        <span className="flex min-w-4 items-center justify-center rounded-full bg-danger px-1 text-[10px] leading-4 text-white">
          {Math.min(unreadAttention, 99)}
        </span>
      ) : null}
    </button>
  );
}

export function ActivityCenterPanel() {
  const language = useLocaleStore((s) => s.language);
  const navigate = useNavigate();
  const open = useActivityCenterStore((s) => s.open);
  const setOpen = useActivityCenterStore((s) => s.setOpen);
  const items = useActivityCenterStore((s) => s.items);
  const markAllRead = useActivityCenterStore((s) => s.markAllRead);
  const runningCount = useMemo(() => items.filter((item) => item.status === 'running').length, [items]);
  const copy = language === 'zh'
    ? { title: '活动', subtitle: '后台任务、异常与待处理事项', empty: '暂无活动', emptyBody: '重要状态会在这里留痕，不再依赖一闪而过的提醒。', read: '全部已读', clear: '清空已完成', close: '关闭活动中心', running: '运行中' }
    : { title: 'Activity', subtitle: 'Background work, issues, and items needing attention', empty: 'No activity yet', emptyBody: 'Important status changes will stay here instead of disappearing.', read: 'Mark all read', clear: 'Clear finished', close: 'Close activity center', running: 'Running' };

  const openItem = (item: ActivityItem) => {
    if (!item.href) return;
    setOpen(false);
    navigate(item.href);
  };

  const clearFinished = () => {
    for (const item of items) {
      if (item.status === 'done') useActivityCenterStore.getState().remove(item.id);
    }
  };

  return (
    <Dialog.Root open={open} onOpenChange={setOpen} modal={false}>
      <Dialog.Portal>
        <Dialog.Content
          className="fixed bottom-2 right-2 top-2 z-[120] flex w-[min(400px,calc(100vw-1rem))] flex-col overflow-hidden rounded-2xl border border-edge bg-surface-panel shadow-elevated outline-none activity-center-enter"
          aria-describedby="activity-center-description"
        >
          <header className="shrink-0 border-b border-edge-subtle px-4 py-3.5">
            <div className="flex items-start gap-3">
              <div className="flex size-8 shrink-0 items-center justify-center rounded-lg bg-accent-soft text-accent-fg">
                <Activity className="size-4" aria-hidden />
              </div>
              <div className="min-w-0 flex-1">
                <Dialog.Title className="text-sm font-semibold text-fg">{copy.title}</Dialog.Title>
                <Dialog.Description id="activity-center-description" className="mt-0.5 text-xs text-fg-muted">
                  {copy.subtitle}
                </Dialog.Description>
              </div>
              <Dialog.Close asChild>
                <button type="button" className="rounded-lg p-1.5 text-fg-subtle hover:bg-surface-hover hover:text-fg focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent" aria-label={copy.close}>
                  <X className="size-4" aria-hidden />
                </button>
              </Dialog.Close>
            </div>
            {runningCount > 0 ? (
              <div className="mt-3 flex items-center gap-2 rounded-lg border border-accent/20 bg-accent-soft px-2.5 py-2 text-xs text-accent-fg">
                <Loader2 className="size-3.5 animate-spin motion-reduce:animate-none" aria-hidden />
                <span>{runningCount} {copy.running}</span>
              </div>
            ) : null}
          </header>

          <div className="min-h-0 flex-1 overflow-y-auto">
            {items.length > 0 ? (
              items.map((item) => <ActivityRow key={item.id} item={item} onOpen={openItem} />)
            ) : (
              <div className="flex h-full min-h-72 flex-col items-center justify-center px-8 text-center">
                <div className="flex size-10 items-center justify-center rounded-xl bg-surface-subtle text-fg-subtle">
                  <Clock3 className="size-5" aria-hidden />
                </div>
                <p className="mt-3 text-sm font-medium text-fg">{copy.empty}</p>
                <p className="mt-1 max-w-64 text-xs leading-5 text-fg-muted">{copy.emptyBody}</p>
              </div>
            )}
          </div>

          {items.length > 0 ? (
            <footer className="flex shrink-0 items-center justify-between gap-2 border-t border-edge-subtle px-3 py-2.5">
              <Button type="button" variant="ghost" className="px-2.5 py-1.5 text-xs" onClick={markAllRead}>
                <Check className="size-3.5" aria-hidden />
                {copy.read}
              </Button>
              <Button type="button" variant="ghost" className="px-2.5 py-1.5 text-xs text-fg-muted" onClick={clearFinished}>
                <Trash2 className="size-3.5" aria-hidden />
                {copy.clear}
              </Button>
            </footer>
          ) : null}
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  );
}
