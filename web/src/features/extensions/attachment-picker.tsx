import * as Dialog from '@radix-ui/react-dialog';
import { useState } from 'react';

export type AttachmentSelection = { name: string; mimeType: string; size: number; encoding: 'base64'; content: string };
export type AttachmentPrompt = { extensionId: string; finish: (selection?: AttachmentSelection) => Promise<void> };
export function AttachmentPicker({ prompt, zh, onClose }: { prompt: AttachmentPrompt; zh: boolean; onClose: () => void }) {
  const [failure, setFailure] = useState(''), [busy, setBusy] = useState(false);
  const cancel = () => { void prompt.finish().catch(() => {}); onClose(); };
  return <Dialog.Root open onOpenChange={open => { if (!open && !busy) cancel(); }}><Dialog.Portal>
    <Dialog.Overlay className="fixed inset-0 z-[130] bg-scrim" />
    <Dialog.Content className="fixed left-1/2 top-1/2 z-[131] flex h-[min(360px,calc(100vh-32px))] w-[min(32rem,calc(100vw-32px))] -translate-x-1/2 -translate-y-1/2 flex-col overflow-hidden rounded-xl border border-edge bg-surface-overlay p-5">
      <Dialog.Title className="text-base font-semibold text-fg">{zh ? '选择要交给应用的附件' : 'Choose an attachment for this app'}</Dialog.Title>
      <Dialog.Description className="mt-2 text-sm text-fg-muted">{zh ? '应用将获得你在此选择的文件内容（最多 512 KiB），不会获得本机路径。取消不会交付任何文件。' : 'The app receives the chosen file content (up to 512 KiB), without your local path. Canceling delivers nothing.'}</Dialog.Description>
      <div className="mt-4 min-h-0 flex-1 overflow-y-auto"><input type="file" aria-label={zh ? '选择附件' : 'Choose attachment'} disabled={busy} onChange={event => {
        const file = event.target.files?.[0]; if (!file) return;
        if (file.size > 512 * 1024) { setFailure(zh ? '文件超过 512 KiB' : 'File exceeds 512 KiB'); return; }
        setBusy(true); setFailure('');
        void file.arrayBuffer().then(async buffer => {
          const bytes = new Uint8Array(buffer); let binary = '';
          for (let offset = 0; offset < bytes.length; offset += 8192) binary += String.fromCharCode(...bytes.subarray(offset, offset + 8192));
          await prompt.finish({ name: file.name, mimeType: file.type || 'application/octet-stream', size: bytes.length, encoding: 'base64', content: btoa(binary) }); onClose();
        }).catch(error => setFailure(error instanceof Error ? error.message : String(error))).finally(() => setBusy(false));
      }} />{failure ? <p role="alert" className="mt-3 text-sm text-danger">{failure}</p> : null}</div>
      <div className="mt-4 flex justify-end"><button type="button" disabled={busy} onClick={cancel} className="rounded-lg border border-edge px-3 py-2">{zh ? '取消' : 'Cancel'}</button></div>
    </Dialog.Content>
  </Dialog.Portal></Dialog.Root>;
}
