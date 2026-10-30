import { useCallback, useEffect, useRef, useState } from 'react';
import type { ComputerPreviewFrame, ComputerPreviewState } from '@xopcai/computer-control-contract';

/** Pixels stay outside React state; each subscription has its own presentation epoch. */
export function useComputerPreview(conversationId: string | null | undefined) {
  const [state, setState] = useState<ComputerPreviewState>();
  const [subscriptionId, setSubscriptionId] = useState<string>();
  const [hasFrame, setHasFrame] = useState(false);
  const [framePreviewId, setFramePreviewId] = useState<string>();
  const [stale, setStale] = useState(false);
  const [retry, setRetry] = useState(0);
  const [visible, setVisible] = useState(true);
  const canvases = useRef(new Set<HTMLCanvasElement>());
  const lastFrameAt = useRef(0);
  const api = window.electronAPI?.computer?.preview;
  const registerCanvas = useCallback((canvas: HTMLCanvasElement | null) => {
    for (const item of canvases.current) if (!item.isConnected) canvases.current.delete(item);
    if (canvas) canvases.current.add(canvas);
  }, []);
  useEffect(() => {
    setState(undefined); setHasFrame(false); setSubscriptionId(undefined);
    if (!conversationId || !api) return;
    let disposed = false, changed = false;
    const off = api.onState(next => {
      if (!disposed && next.conversationId === conversationId) { changed = true; setState(next); }
    });
    void api.current(conversationId).then(next => { if (!disposed && !changed) setState(next?.conversationId === conversationId ? next : undefined); }).catch(() => {});
    return () => { disposed = true; off(); };
  }, [api, conversationId]);
  const previewId = state?.previewId;
  const targetEpoch = state?.targetEpoch;
  const runId = state?.runId;
  const preparingTarget = state?.status === 'preparing' && !subscriptionId;
  const ended = state?.status === 'ended';
  useEffect(() => {
    setHasFrame(false); setStale(false); lastFrameAt.current = 0;
    if (!api || !conversationId || !previewId || targetEpoch === undefined || ended) return;
    // A pre-authorization card has no target yet; the host issues a new ID once bound.
    if (preparingTarget && retry === 0) return;
    let disposed = false;
    let id: string | undefined;
    let latestStream = 0, latestSequence = 0;
    const receive = async (message: ComputerPreviewFrame | ComputerPreviewState) => {
      if (disposed || message.previewId !== previewId || message.targetEpoch !== targetEpoch) return;
      if (!('sequence' in message)) { setState(message); return; }
      if (message.streamEpoch < latestStream || message.streamEpoch === latestStream && message.sequence <= latestSequence) return;
      latestStream = message.streamEpoch; latestSequence = message.sequence;
      const bytes = new Uint8Array(message.bytes);
      let bitmap: ImageBitmap | undefined;
      try {
        bitmap = await createImageBitmap(new Blob([bytes], { type: 'image/jpeg' }));
        if (disposed || latestStream !== message.streamEpoch || latestSequence !== message.sequence) return;
        for (const canvas of canvases.current) {
          if (!canvas.isConnected) { canvases.current.delete(canvas); continue; }
          canvas.width = bitmap.width; canvas.height = bitmap.height;
          canvas.getContext('2d')?.drawImage(bitmap, 0, 0);
        }
        lastFrameAt.current = performance.now(); setFramePreviewId(previewId); setHasFrame(true); setStale(false);
      } finally { bitmap?.close(); }
    };
    void api.subscribe({ conversationId, runId, preset: 'compact' }, receive).then(result => {
      id = result.subscriptionId;
      if (disposed) void api.unsubscribe(id).catch(() => {});
      else setSubscriptionId(id);
    }).catch(() => {
      if (!disposed) setState(current => current?.previewId === previewId
        ? { ...current, status: 'unavailable', errorCode: 'COMPUTER_PREVIEW_UNAVAILABLE' } : current);
    });
    return () => { disposed = true; setSubscriptionId(undefined); if (id) void api.unsubscribe(id).catch(() => {}); };
    // Host state changes must not recreate the media subscription on every status update.
  }, [api, conversationId, previewId, targetEpoch, runId, retry, ended]);
  useEffect(() => {
    const changed = () => setVisible(document.visibilityState !== 'hidden');
    changed(); document.addEventListener('visibilitychange', changed);
    const timer = setInterval(() => { if (lastFrameAt.current) setStale(performance.now() - lastFrameAt.current > 1500); }, 500);
    return () => { clearInterval(timer); document.removeEventListener('visibilitychange', changed); };
  }, []);
  return { state, subscriptionId, hasFrame: hasFrame && framePreviewId === state?.previewId, stale, visible, registerCanvas, retry: () => setRetry(value => value + 1), api };
}
