import * as Dialog from '@radix-ui/react-dialog';
import { Brain, CalendarDays, Check, FileText, Loader2, ListChecks, X } from 'lucide-react';
import { useLocation, useNavigate } from 'react-router-dom';

import { APP_CHROME_NO_DRAG_CLASS } from '@/components/shell/app-chrome';
import { Button } from '@/components/ui/button';
import { messages } from '@/i18n/messages';
import { cn } from '@/lib/cn';
import { loadWorkDiscoveryOverlay, preloadRouteForPath } from '@/lib/route-preload';
import { useLocaleStore } from '@/stores/locale-store';

import { useUnderstandingActivityStore } from './understanding-activity-store';
import { openWorkDiscoveryOverlaySearch } from './work-discovery-navigation';

export function UnderstandingStatusButton({
  floating = false,
  persistent = false,
}: {
  floating?: boolean;
  persistent?: boolean;
}) {
  const navigate = useNavigate();
  const location = useLocation();
  const language = useLocaleStore((state) => state.language);
  const state = useUnderstandingActivityStore();
  const zh = language === 'zh';
  const preloadWorkDiscovery = () => {
    if (persistent) void loadWorkDiscoveryOverlay();
    else preloadRouteForPath('/onboarding/workspace');
  };
  const openWorkDiscovery = () => {
    if (!persistent) {
      navigate('/onboarding/workspace?new=1');
      return;
    }
    navigate({ pathname: location.pathname, search: openWorkDiscoveryOverlaySearch(location.search) });
  };
  if (state.status === 'idle') {
    if (!persistent) return null;
    const label = messages(language).you.relearn;
    return (
      <Button
        type="button"
        variant="ghost"
        className={cn(
          'relative size-8 rounded-xl p-0',
          APP_CHROME_NO_DRAG_CLASS,
          floating && 'fixed right-4 top-3 z-40 bg-surface-panel shadow-surface',
        )}
        title={label}
        aria-label={label}
        data-work-discovery-trigger
        onPointerEnter={preloadWorkDiscovery}
        onPointerDown={preloadWorkDiscovery}
        onFocus={preloadWorkDiscovery}
        onClick={openWorkDiscovery}
      >
        <Brain className="size-4 text-accent-fg" aria-hidden />
      </Button>
    );
  }
  const running = state.status === 'running';
  const sourceRows = window.electronAPI?.platform === 'darwin' ? [
    { key: 'apple_notes' as const, label: 'Apple Notes', icon: FileText },
    { key: 'calendar' as const, label: zh ? '日历' : 'Calendar', icon: CalendarDays },
    { key: 'reminders' as const, label: zh ? '提醒事项' : 'Reminders', icon: ListChecks },
  ] : [];
  return (
    <Dialog.Root modal={false} open={state.drawerOpen} onOpenChange={state.setDrawerOpen}>
      <Dialog.Trigger asChild>
        <Button
          type="button"
          variant="ghost"
          className={cn(
            'relative size-8 rounded-xl p-0',
            APP_CHROME_NO_DRAG_CLASS,
            floating && 'fixed right-4 top-3 z-40 bg-surface-panel shadow-surface',
          )}
          title={zh ? '查看用户理解进度' : 'View understanding progress'}
        >
          {running ? <Loader2 className="size-4 animate-spin" /> : <Brain className="size-4 text-accent-fg" />}
          {state.status === 'review_ready' ? <span className="absolute right-0.5 top-0.5 size-2 rounded-full bg-accent" /> : null}
        </Button>
      </Dialog.Trigger>
      <Dialog.Portal>
        <Dialog.Content className="xopc-drawer-right fixed inset-y-0 right-0 z-[61] flex w-[min(26rem,calc(100vw-2rem))] flex-col border-l border-edge bg-surface-panel shadow-float">
          <div className="flex h-14 shrink-0 items-center justify-between border-b border-edge px-4">
            <div><Dialog.Title className="font-semibold text-fg">{zh ? '正在理解你的工作' : 'Understanding your work'}</Dialog.Title><Dialog.Description className="text-xs text-fg-muted">{running ? (zh ? '后台调查仍在进行' : 'Background investigation is running') : (zh ? '本轮调查已有结果' : 'This investigation has results')}</Dialog.Description></div>
            <Dialog.Close asChild><Button variant="ghost" className="size-8 p-0"><X className="size-4" /></Button></Dialog.Close>
          </div>
          <div className="min-h-0 flex-1 overflow-y-auto p-4">
            <div className="space-y-2">
              <SourceRow label={zh ? '工作目录' : 'Work directories'} status={state.directoryStatus} count={0} icon={Brain} zh={zh} />
              {sourceRows.map((row) => <SourceRow key={row.key} label={row.label} status={state.sources[row.key]} count={state.itemCounts[row.key]} icon={row.icon} zh={zh} />)}
            </div>
            {state.threads.length ? <div className="mt-6"><h3 className="text-sm font-semibold text-fg">{zh ? '综合识别到的工作重点' : 'Work focus across sources'}</h3><div className="mt-2 space-y-2">{state.threads.map((thread) => <div key={thread.id} className="rounded-xl border border-edge bg-surface-base p-3"><div className="flex items-center gap-2"><span className="rounded-full bg-accent-soft px-2 py-0.5 text-[0.7rem] font-medium text-accent-fg">{thread.horizon === 'current' ? (zh ? '当前' : 'Current') : thread.horizon === 'ongoing' ? (zh ? '持续' : 'Ongoing') : (zh ? '长期' : 'Long term')}</span><p className="text-sm font-medium text-fg">{thread.title}</p></div><p className="mt-1.5 text-xs leading-5 text-fg-muted">{thread.summary}</p></div>)}</div></div> : null}
            {state.memories.length ? <div className="mt-6"><h3 className="text-sm font-semibold text-fg">{zh ? `新理解到 ${state.memories.length} 条背景` : `${state.memories.length} new insights`}</h3><div className="mt-2 space-y-2">{state.memories.map((memory) => <div key={memory.id} className="rounded-xl bg-surface-base p-3 text-sm leading-6 text-fg"><p>{memory.statement}</p>{memory.status === 'pending' && memory.memoryRecordId ? <div className="mt-2 flex gap-2"><Button type="button" className="px-2.5 py-1.5 text-xs" variant="primary" onClick={() => void state.reviewMemory(memory.memoryRecordId!, true)}>{zh ? '记住' : 'Remember'}</Button><Button type="button" className="px-2.5 py-1.5 text-xs" variant="ghost" onClick={() => void state.reviewMemory(memory.memoryRecordId!, false)}>{zh ? '忽略' : 'Ignore'}</Button></div> : <p className="mt-1 text-xs text-fg-muted">{memory.status === 'accepted' ? (zh ? '已写入长期记忆' : 'Saved to memory') : (zh ? '已忽略' : 'Ignored')}</p>}</div>)}</div></div> : null}
            {state.error ? <p className="mt-4 text-sm text-danger">{state.error}</p> : null}
          </div>
          {!running ? <div className="flex shrink-0 gap-2 border-t border-edge p-4"><Button type="button" className="flex-1" onPointerEnter={preloadWorkDiscovery} onPointerDown={preloadWorkDiscovery} onFocus={preloadWorkDiscovery} onClick={() => { state.finish(); openWorkDiscovery(); }}>{zh ? '重新理解' : 'Run again'}</Button><Button type="button" variant="primary" className="flex-1" onClick={state.finish}>{zh ? '完成' : 'Done'}</Button></div> : null}
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  );
}

function SourceRow({ label, status, count, icon: Icon, zh }: { label: string; status: string; count: number; icon: typeof Brain; zh: boolean }) {
  const done = status === 'completed';
  return <div className="flex items-center gap-3 rounded-xl border border-edge px-3 py-3"><Icon className="size-4 text-fg-muted" /><div className="min-w-0 flex-1"><p className="text-sm font-medium text-fg">{label}</p><p className="text-xs text-fg-muted">{status === 'running' ? (zh ? '正在扫描' : 'Scanning') : status === 'denied' ? (zh ? '未授权' : 'Permission denied') : status === 'failed' ? (zh ? '扫描失败' : 'Failed') : done ? (count ? `${count} ${zh ? '项' : 'items'}` : (zh ? '已完成' : 'Completed')) : (zh ? '等待开始' : 'Waiting')}</p></div>{done ? <Check className="size-4 text-success" /> : status === 'running' ? <Loader2 className="size-4 animate-spin text-accent" /> : null}</div>;
}
