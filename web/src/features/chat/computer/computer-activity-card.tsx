import { Monitor } from 'lucide-react';
import { useEffect, useRef, useState } from 'react';
import { Skeleton } from '@/components/ui/skeleton';
import { useLocaleStore } from '@/stores/locale-store';
import { computerPreviewActivity } from './computer-preview-activity';
import { COMPUTER_PREVIEW_MAX_HEIGHT, computerPreviewRatio, type ComputerPreviewSize } from './computer-preview-layout';
import { useComputerPreview } from './use-computer-preview';

export function ComputerActivityCard({ conversationId, onFrameSizeChange }: {
  conversationId?: string | null;
  onFrameSizeChange?: (size: ComputerPreviewSize) => void;
}) {
  const preview = useComputerPreview(conversationId);
  const [inViewport, setInViewport] = useState(true);
  const [focusing, setFocusing] = useState(false), [focusError, setFocusError] = useState(false);
  const container = useRef<HTMLElement>(null);
  const zh = useLocaleStore(s => s.language === 'zh');
  const id = preview.state?.previewId;
  useEffect(() => { if (preview.frameSize) onFrameSizeChange?.(preview.frameSize); }, [preview.frameSize, onFrameSizeChange]);
  useEffect(() => { setFocusError(false); }, [id]);
  useEffect(() => {
    if (!container.current || typeof IntersectionObserver === 'undefined') return;
    const observer = new IntersectionObserver(entries => setInViewport(entries.some(entry => entry.isIntersecting)), { rootMargin: '160px' });
    observer.observe(container.current);
    return () => observer.disconnect();
  }, [id]);
  useEffect(() => {
    if (!preview.subscriptionId || !preview.api) return;
    void preview.api.setPreset(preview.subscriptionId, preview.visible && inViewport ? 'compact' : 'paused').catch(() => {});
  }, [preview.api, preview.subscriptionId, preview.visible, inViewport]);
  if (!preview.state || preview.state.conversationId !== conversationId || preview.state.status === 'ended') return null;
  const unavailable = preview.state.status === 'unavailable';
  const activity = focusError ? (zh ? '重试切换' : 'Retry switch')
    : preview.stale ? (zh ? '等待新画面' : 'Waiting for a new frame') : computerPreviewActivity(preview.state.activity, zh);
  const focus = async () => {
    const api = window.electronAPI?.computer;
    if (!api?.focusTarget || !conversationId || !id || focusing) return;
    setFocusing(true); setFocusError(false);
    try { await api.focusTarget(conversationId, id); }
    catch { setFocusError(true); }
    finally { setFocusing(false); }
  };
  return <section ref={container} aria-label={zh ? '电脑操作预览' : 'Computer activity'}
    className="relative w-full overflow-hidden rounded-xl bg-transparent"
    style={{ aspectRatio: computerPreviewRatio(preview.frameSize) ?? 16 / 10, maxHeight: COMPUTER_PREVIEW_MAX_HEIGHT }}>
    {!preview.hasFrame && !unavailable && <Skeleton className="absolute inset-0" />}
    <canvas ref={preview.registerCanvas} role="img" aria-label={zh ? `${preview.state.appName}窗口预览` : `${preview.state.appName} window preview`}
      className={`absolute inset-0 h-full w-full object-contain ${preview.hasFrame && !unavailable ? '' : 'invisible'}`} />
    {!unavailable && <div role="status" aria-live="polite" className="absolute left-2 top-2 z-10 max-w-[calc(100%-1rem)]">
      <button type="button" disabled={focusing || !window.electronAPI?.computer?.focusTarget}
        aria-label={zh ? '切换到正在操作的应用' : 'Switch to the active app'}
        title={focusError ? (zh ? '暂时无法切换应用，请重试' : 'Could not switch to the app. Try again.') : (zh ? '切换到应用' : 'Switch to app')}
        className="inline-flex min-h-11 min-w-11 max-w-full sm:min-h-9 sm:min-w-9 items-center justify-center gap-1.5 rounded-md bg-surface-overlay/80 px-2 text-xs text-fg backdrop-blur-sm hover:bg-surface-overlay focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent"
        onClick={() => { void focus(); }}>
        <Monitor size={14} className="shrink-0" aria-hidden />{activity && <span className="truncate">{activity}</span>}
      </button>
    </div>}
    {unavailable && <div className="absolute inset-0 flex items-center justify-center bg-surface-panel/90">
      <button className="min-h-11 rounded-md px-3 text-sm text-fg-muted focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent" onClick={preview.retry}>
        {zh ? '预览暂时不可用，点击重试' : 'Preview unavailable. Retry preview'}
      </button>
    </div>}
  </section>;
}
