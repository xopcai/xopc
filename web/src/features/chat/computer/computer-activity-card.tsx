import * as Dialog from '@radix-ui/react-dialog';
import { ChevronDown, ChevronUp, Maximize2, Monitor, X } from 'lucide-react';
import { useEffect, useRef, useState } from 'react';
import { Skeleton } from '@/components/ui/skeleton';
import { useLocaleStore } from '@/stores/locale-store';
import { useComputerPreview } from './use-computer-preview';

const button = 'inline-flex min-h-11 min-w-11 items-center justify-center rounded-md px-2 text-xs text-fg-muted hover:bg-surface-hover focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent disabled:opacity-50 sm:min-h-9 sm:min-w-9';

export function ComputerActivityCard({ conversationId }: { conversationId?: string | null }) {
  const preview = useComputerPreview(conversationId);
  const [collapsed, setCollapsed] = useState(false), [expanded, setExpanded] = useState(false);
  const [inViewport, setInViewport] = useState(true);
  const [stopping, setStopping] = useState(false), [takenOver, setTakenOver] = useState(false), [stopError, setStopError] = useState(false);
  const container = useRef<HTMLElement>(null);
  const zh = useLocaleStore(s => s.language === 'zh');
  const id = preview.state?.previewId;
  useEffect(() => { setCollapsed(false); setExpanded(false); setTakenOver(false); setStopError(false); }, [id]);
  useEffect(() => {
    if (!container.current || typeof IntersectionObserver === 'undefined') return;
    const observer = new IntersectionObserver(entries => setInViewport(entries.some(entry => entry.isIntersecting)), { rootMargin: '160px' });
    observer.observe(container.current);
    return () => observer.disconnect();
  }, [id]);
  useEffect(() => {
    if (!preview.subscriptionId || !preview.api) return;
    const preset = !preview.visible || !expanded && (collapsed || !inViewport) ? 'paused' : expanded ? 'expanded' : 'compact';
    void preview.api.setPreset(preview.subscriptionId, preset).catch(() => {});
  }, [preview.api, preview.subscriptionId, preview.visible, expanded, collapsed, inViewport]);
  if (!preview.state || preview.state.conversationId !== conversationId) return null;
  const ended = preview.state.status === 'ended';
  const unavailable = preview.state.status === 'unavailable';
  const live = preview.state.status === 'live' && !preview.stale;
  const status = takenOver ? (zh ? '已停止，可以接管' : 'Stopped — ready for you')
    : stopping ? (zh ? '正在停止操作' : 'Stopping control')
      : ended ? (zh ? '操作已结束' : 'Control ended')
        : unavailable ? (zh ? '预览暂时不可用' : 'Preview unavailable')
          : preview.state.status === 'paused' ? (zh ? '预览已暂停' : 'Preview paused')
            : preview.stale ? (zh ? '等待新画面' : 'Waiting for a new frame')
              : live ? (zh ? '实时预览' : 'Live preview') : (zh ? '正在准备窗口预览' : 'Preparing window preview');
  const stop = async () => {
    if (!preview.api || !preview.subscriptionId || stopping) return;
    setStopping(true); setStopError(false);
    try { await preview.api.stopControl(preview.subscriptionId); setTakenOver(true); setExpanded(false); }
    catch { setStopError(true); }
    finally { setStopping(false); }
  };
  const surface = (large: boolean) => <div className={`relative flex min-h-0 items-center justify-center overflow-hidden bg-surface-inset ${large ? 'flex-1' : 'h-52 sm:h-60'}`}>
    {!preview.hasFrame && !unavailable && <Skeleton className="absolute inset-3" />}
    <canvas ref={preview.registerCanvas} role="img" aria-label={zh ? `${preview.state!.appName}窗口预览` : `${preview.state!.appName} window preview`}
      className={`max-h-full max-w-full object-contain ${preview.hasFrame && !unavailable ? '' : 'invisible'}`} />
    {(unavailable || preview.stale) && <div className="absolute inset-0 flex flex-col items-center justify-center gap-2 bg-surface-panel/90 text-sm text-fg-muted">
      <span>{status}</span>{unavailable && <button className={button} onClick={preview.retry}>{zh ? '重试预览' : 'Retry preview'}</button>}
    </div>}
  </div>;
  const controls = <div className="flex shrink-0 items-center justify-between gap-3 border-t border-edge px-3 py-2">
    <span role="status" aria-atomic="true" className="text-xs text-fg-muted">{stopError ? (zh ? '尚未确认停止，请使用全局停止操作' : 'Stop is unconfirmed. Use the global stop control.') : status}</span>
    {!ended && <button className={button} disabled={!preview.subscriptionId || stopping} onClick={() => { void stop(); }}>{zh ? '停止并接管' : 'Stop and take over'}</button>}
  </div>;
  return <section ref={container} aria-label={zh ? '电脑操作预览' : 'Computer activity'} className="w-full overflow-hidden rounded-xl border border-edge bg-surface-panel">
    <div className="flex min-h-11 items-center gap-2 px-3 py-1">
      <Monitor size={16} aria-hidden className="shrink-0 text-fg-muted" />
      <span className="min-w-0 flex-1 truncate text-sm text-fg">{preview.state.appName}</span>
      {!ended && <button className={button} aria-label={zh ? '放大预览' : 'Expand preview'} onClick={() => setExpanded(true)}><Maximize2 size={15} /></button>}
      {!ended && <button className={button} aria-expanded={!collapsed} aria-label={collapsed ? (zh ? '展开预览' : 'Show preview') : (zh ? '收起预览' : 'Hide preview')}
        onClick={() => setCollapsed(value => !value)}>{collapsed ? <ChevronDown size={16} /> : <ChevronUp size={16} />}</button>}
    </div>
    {!collapsed && !ended && surface(false)}
    {!expanded && controls}
    <Dialog.Root open={expanded && !ended} onOpenChange={setExpanded}>
      <Dialog.Portal><Dialog.Overlay className="fixed inset-0 z-50 bg-black/50" />
        <Dialog.Content className="fixed left-1/2 top-1/2 z-50 flex h-[min(80dvh,760px)] w-[min(94vw,1100px)] -translate-x-1/2 -translate-y-1/2 flex-col overflow-hidden rounded-xl border border-edge bg-surface-overlay">
          <div className="flex shrink-0 items-center justify-between border-b border-edge px-4 py-2">
            <Dialog.Title className="text-sm font-medium text-fg">{preview.state.appName}</Dialog.Title>
            <Dialog.Description className="sr-only">{zh ? '当前授权窗口的实时预览' : 'Live preview of the currently authorized window'}</Dialog.Description>
            <Dialog.Close className={button} aria-label={zh ? '关闭放大预览' : 'Close expanded preview'}><X size={18} /></Dialog.Close>
          </div>
          {surface(true)}{controls}
        </Dialog.Content></Dialog.Portal>
    </Dialog.Root>
  </section>;
}
