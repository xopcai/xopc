import * as Dialog from '@radix-ui/react-dialog';
import { useState } from 'react';
import useSWR from 'swr';
import { Skeleton } from '@/components/ui/skeleton';
import { fetchJson } from '@/lib/fetch';
import { apiUrl } from '@/lib/url';

export function ResourceRequestDialog({ extensionId, requestId, zh, onClose }: {
  extensionId: string; requestId: string; zh: boolean; onClose: () => void;
}) {
  const url = `/api/extensions/${encodeURIComponent(extensionId)}/resource-requests/${encodeURIComponent(requestId)}`;
  const { data, isLoading, error } = useSWR(url, path => fetchJson<{ request: { kind: 'export' | 'connector'; status: string;
    digest: string; accountLabel?: string; binding?: unknown; input: { name?: string; encoding?: string; content?: string } & Record<string, unknown> } }>(apiUrl(path)));
  const [busy, setBusy] = useState(false), [failure, setFailure] = useState('');
  const decide = async (approve: boolean) => {
    if (!data) return;
    setBusy(true); setFailure('');
    try {
      const result = await fetchJson<{ status: string }>(apiUrl(`${url}/review`), { method: 'POST', body: JSON.stringify({ digest: data.request.digest, approve }) });
      if (approve && result.status === 'approved' && data.request.kind === 'export') {
        const input = data.request.input;
        const bytes = input.encoding === 'base64' ? Uint8Array.from(atob(input.content ?? ''), value => value.charCodeAt(0)) : new TextEncoder().encode(input.content ?? '');
        const href = URL.createObjectURL(new Blob([bytes], { type: 'application/octet-stream' }));
        const anchor = document.createElement('a'); anchor.href = href; anchor.download = input.name ?? 'export.bin';
        document.body.append(anchor); anchor.click(); anchor.remove(); setTimeout(() => URL.revokeObjectURL(href), 30000);
      }
      onClose();
    } catch (error) { setFailure(error instanceof Error ? error.message : String(error)); }
    finally { setBusy(false); }
  };
  return <Dialog.Root open onOpenChange={open => { if (!open && !busy) onClose(); }}><Dialog.Portal>
    <Dialog.Overlay className="fixed inset-0 z-[130] bg-scrim" />
    <Dialog.Content className="fixed left-1/2 top-1/2 z-[131] flex h-[min(720px,calc(100vh-32px))] w-[min(42rem,calc(100vw-32px))] -translate-x-1/2 -translate-y-1/2 flex-col overflow-hidden rounded-xl border border-edge bg-surface-overlay p-5">
      <Dialog.Title className="text-base font-semibold text-fg">{zh ? '审核应用资源请求' : 'Review app resource request'}</Dialog.Title>
      <Dialog.Description className="mt-2 text-sm text-fg-muted">{zh ? '连接器操作绑定以下账户和完整参数，可能产生外部影响或费用。文件导出由浏览器保存，不覆盖 Gateway 文件。关闭窗口不会批准请求。' : 'Connector operations use the exact account and arguments below and may cause external effects or fees. Exports are browser saves and do not overwrite Gateway files. Closing grants nothing.'}</Dialog.Description>
      <div className="mt-3 min-h-0 flex-1 space-y-3 overflow-y-auto text-sm text-fg">
        {isLoading ? <Skeleton className="h-48" /> : error ? <p role="alert">{zh ? '无法读取请求，请检查授权后重试。' : 'Could not load request. Check authorization and retry.'}</p> : data ? <>
          <p>{zh ? '状态' : 'Status'}: {data.request.status}</p>
          {data.request.accountLabel ? <p>{zh ? '账户' : 'Account'}: {data.request.accountLabel}</p> : null}
          {data.request.binding ? <pre className="whitespace-pre-wrap break-all text-xs">{JSON.stringify(data.request.binding, null, 2)}</pre> : null}
          <pre className="whitespace-pre-wrap break-all text-xs">{JSON.stringify(data.request.input, null, 2)}</pre>
        </> : null}
      </div>
      {failure ? <p role="alert" className="mt-2 text-xs text-danger">{failure}</p> : null}
      <div className="mt-4 flex justify-end gap-2"><button type="button" disabled={busy} onClick={onClose} className="rounded-lg border border-edge px-3 py-2">{zh ? '关闭' : 'Close'}</button>
        <button type="button" disabled={busy || !data || data.request.status !== 'pending'} onClick={() => void decide(false)} className="rounded-lg border border-edge px-3 py-2">{zh ? '拒绝请求' : 'Reject request'}</button>
        <button type="button" disabled={busy || !data || !['pending', 'approved'].includes(data.request.status)} onClick={() => void decide(true)} className="rounded-lg bg-accent px-3 py-2 text-on-accent">{data?.request.kind === 'export' ? zh ? '确认并保存文件' : 'Approve and save file' : zh ? '确认执行' : 'Approve execution'}</button></div>
    </Dialog.Content>
  </Dialog.Portal></Dialog.Root>;
}
