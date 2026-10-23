import * as Dialog from '@radix-ui/react-dialog';
import { RefreshCw, X } from 'lucide-react';
import { useEffect, useState } from 'react';

import { Button } from '@/components/ui/button';
import { Skeleton } from '@/components/ui/skeleton';
import { apiFetch } from '@/lib/fetch';
import { apiUrl } from '@/lib/url';

import { fetchPhoneScreen, type PhoneDevice } from './phone-api';

export function PhoneScreenDialog({ device, sessionId, zh, onClose }: {
  device: PhoneDevice; sessionId?: string; zh: boolean; onClose(): void;
}) {
  const [revision, setRevision] = useState(0);
  const [image, setImage] = useState<string>();
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(true);
  useEffect(() => {
    const controller = new AbortController();
    let active = true;
    let objectUrl: string | undefined;
    setLoading(true); setError(''); setImage(undefined);
    const load = async () => {
      try {
        let blob: Blob;
        if (sessionId) {
          const response = await apiFetch(apiUrl(`/api/phone/sessions/${sessionId}/screen`), { signal: controller.signal });
          if (!response.ok) throw new Error(zh ? '当前无法查看屏幕，请暂停任务后重试' : 'Screen unavailable. Pause the task and retry.');
          blob = await response.blob();
        } else blob = await fetchPhoneScreen(device.id, controller.signal);
        if (!active) return;
        objectUrl = URL.createObjectURL(blob); setImage(objectUrl);
      } catch (cause) {
        if (active) setError(cause instanceof Error ? cause.message : String(cause));
      } finally { if (active) setLoading(false); }
    };
    void load();
    return () => { active = false; controller.abort(); if (objectUrl) URL.revokeObjectURL(objectUrl); };
  }, [device.id, sessionId, revision, zh]);

  return <Dialog.Root open onOpenChange={open => { if (!open) onClose(); }}><Dialog.Portal>
    <Dialog.Overlay className="fixed inset-0 z-[80] bg-black/40" />
    <Dialog.Content className="fixed left-1/2 top-1/2 z-[81] flex h-[min(48rem,90dvh)] w-[min(30rem,calc(100vw-2rem))] -translate-x-1/2 -translate-y-1/2 flex-col overflow-hidden rounded-2xl border border-edge bg-surface-overlay text-fg">
      <div className="flex shrink-0 items-start justify-between gap-3 border-b border-edge p-4">
        <div className="min-w-0"><Dialog.Title className="text-base font-semibold">{zh ? '手机屏幕' : 'Phone screen'}</Dialog.Title><Dialog.Description className="mt-1 truncate text-sm text-fg-muted">{device.name} · {zh ? '仅查看' : 'View only'}</Dialog.Description></div>
        <Dialog.Close asChild><Button variant="ghost" aria-label={zh ? '关闭预览' : 'Close preview'}><X className="size-4" /></Button></Dialog.Close>
      </div>
      <div className="flex min-h-0 flex-1 items-center justify-center overflow-hidden bg-surface-inset p-3" aria-busy={loading}>
        {loading ? <Skeleton className="h-full w-full rounded-lg" /> : error ? <p role="alert" className="max-h-full overflow-y-auto break-words p-4 text-sm text-danger">{error}</p> : image ? <img src={image} alt={zh ? '授权手机的当前屏幕截图' : 'Current screenshot of the authorized phone'} className="h-full w-full object-contain" /> : null}
      </div>
      <div className="flex shrink-0 items-center justify-between gap-3 border-t border-edge p-4"><p className="text-xs text-fg-muted">{zh ? '临时截图，不保存到聊天或附件库。' : 'Temporary screenshot; not saved to chat or attachments.'}</p><Button disabled={loading} onClick={() => setRevision(value => value + 1)}><RefreshCw className="size-4" />{zh ? '刷新画面' : 'Refresh screen'}</Button></div>
    </Dialog.Content>
  </Dialog.Portal></Dialog.Root>;
}
