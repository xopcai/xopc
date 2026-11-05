import * as Dialog from '@radix-ui/react-dialog';
import { useState } from 'react';
import useSWR from 'swr';

import { Button } from '@/components/ui/button';
import { PopoverSelect } from '@/components/ui/popover-select';
import { Skeleton } from '@/components/ui/skeleton';
import { fetchJson } from '@/lib/fetch';
import { apiUrl } from '@/lib/url';

type Directory = {
  files: Array<{ fileId: string; name: string; size: number; sourceName: string }>;
  tools: Array<{ toolName: string; title: string; input: string }>;
};

export function ArtifactTransfer({ conversationId, deviceName, zh }: { conversationId: string; deviceName: string; zh: boolean }) {
  const [open, setOpen] = useState(false);
  const [fileId, setFileId] = useState('');
  const [toolName, setToolName] = useState('');
  const [request, setRequest] = useState('');
  const [saving, setSaving] = useState(false);
  const [copied, setCopied] = useState(false);
  const [error, setError] = useState(false);
  const path = apiUrl('/api/endpoint-tools/artifact-transfers');
  const { data, isLoading } = useSWR(open ? `${path}?conversationId=${encodeURIComponent(conversationId)}` : null,
    url => fetchJson<{ payload: Directory }>(url), { shouldRetryOnError: false });
  const files = data?.payload.files ?? [];
  const tools = data?.payload.tools ?? [];
  const selectedTool = tools.find(tool => tool.toolName === toolName);
  return <Dialog.Root open={open} onOpenChange={next => {
    setOpen(next);
    if (next) { setFileId(''); setToolName(''); setRequest(''); setCopied(false); setError(false); }
  }}>
    <Dialog.Trigger asChild><Button variant="ghost" className="h-8 px-2 text-sm">{zh ? '传递文件' : 'Transfer file'}</Button></Dialog.Trigger>
    <Dialog.Portal>
      <Dialog.Overlay className="fixed inset-0 z-50 bg-black/50" />
      <Dialog.Content className="fixed left-1/2 top-1/2 z-50 flex h-[min(23rem,90dvh)] w-[min(28rem,92vw)] -translate-x-1/2 -translate-y-1/2 flex-col overflow-hidden rounded-xl border border-edge bg-surface p-4 shadow-xl">
        <Dialog.Title className="text-base font-semibold">{zh ? '向执行设备传递文件' : 'Transfer file to execution device'}</Dialog.Title>
        <Dialog.Description className="mt-1 text-sm text-fg-muted">{deviceName}</Dialog.Description>
        <div className="min-h-0 flex-1 space-y-3 overflow-y-auto py-3">
          {isLoading ? <Skeleton className="h-20 w-full" /> : files.length && tools.length ? <>
            <PopoverSelect value={fileId} onChange={setFileId} placeholder={zh ? '选择源文件' : 'Select source file'}
              options={files.map(file => ({ value: file.fileId, label: `${file.name} · ${file.sourceName} · ${Math.ceil(file.size / 1024)} KB` }))} />
            <PopoverSelect value={toolName} onChange={setToolName} placeholder={zh ? '选择接收能力' : 'Select receiving capability'}
              options={tools.map(tool => ({ value: tool.toolName, label: tool.title }))} />
          </> : <p className="text-sm text-fg-muted">{zh ? '当前没有可传递的文件或接收能力。' : 'No eligible file or receiving capability is available.'}</p>}
          {request ? <>
            <p className="text-xs text-fg-muted">{zh ? '在两分钟内将这段请求发到当前对话。' : 'Send this request in this chat within two minutes.'}</p>
            <textarea readOnly className="h-20 w-full resize-none rounded-md border border-edge bg-surface p-2 text-xs"
              value={request} aria-label={zh ? '对话请求' : 'Chat request'} onFocus={event => event.currentTarget.select()} />
          </> : null}
          {error ? <p role="alert" className="text-xs text-danger">{zh ? '文件授权失败，请重新选择设备或文件。' : 'Unable to authorize transfer. Reselect the device or file.'}</p> : null}
        </div>
        <div className="flex justify-end gap-2">
          <Dialog.Close asChild><Button variant="secondary">{zh ? '关闭' : 'Close'}</Button></Dialog.Close>
          {request ? <Button onClick={async () => {
            try { await navigator.clipboard.writeText(request); setCopied(true); }
            catch { setCopied(false); }
          }}>{copied ? (zh ? '已复制' : 'Copied') : (zh ? '复制请求' : 'Copy request')}</Button> : <Button disabled={saving || !selectedTool || !files.some(file => file.fileId === fileId)} onClick={async () => {
            if (!selectedTool) return;
            setSaving(true); setError(false);
            try {
              const issued = await fetchJson<{ payload: { transferId: string } }>(path, {
                method: 'POST', body: JSON.stringify({ conversationId, fileId, toolName }),
              });
              const argumentsHint = JSON.stringify({ [selectedTool.input]: issued.payload.transferId });
              setRequest(zh ? `请在当前执行设备调用 ${toolName} 处理已授权的文件，使用参数 ${argumentsHint}。`
                : `Use ${toolName} on the selected execution device to process the authorized file with argument ${argumentsHint}.`);
            } catch { setError(true); }
            finally { setSaving(false); }
          }}>{saving ? (zh ? '授权中…' : 'Authorizing…') : (zh ? '生成一次性授权' : 'Authorize one transfer')}</Button>}
        </div>
      </Dialog.Content>
    </Dialog.Portal>
  </Dialog.Root>;
}
