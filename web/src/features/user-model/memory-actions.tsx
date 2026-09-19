import * as Dialog from '@radix-ui/react-dialog';
import * as DropdownMenu from '@radix-ui/react-dropdown-menu';
import { MoreHorizontal, Pencil, Trash2 } from 'lucide-react';
import { useState } from 'react';

import { Button } from '@/components/ui/button';

export function MemoryActions({ language, busy, statement, onEdit, onDelete }: {
  language: 'en' | 'zh';
  busy: boolean;
  statement: string;
  onEdit: () => void;
  onDelete: () => void;
}) {
  const [confirming, setConfirming] = useState(false);
  const zh = language === 'zh';
  const itemClass = 'flex min-h-11 cursor-pointer items-center gap-2 rounded-lg px-3 text-sm text-fg outline-none focus:bg-surface-hover data-[disabled]:pointer-events-none data-[disabled]:opacity-50';
  return (
    <Dialog.Root open={confirming} onOpenChange={setConfirming}>
      <DropdownMenu.Root modal={false}>
        <DropdownMenu.Trigger asChild>
          <Button variant="ghost" className="size-11 shrink-0 p-0" disabled={busy} aria-label={zh ? '修改或删除这条内容' : 'Edit or delete this item'}>
            <MoreHorizontal className="size-4" aria-hidden="true" />
          </Button>
        </DropdownMenu.Trigger>
        <DropdownMenu.Portal>
          <DropdownMenu.Content align="end" sideOffset={4} className="z-[100] min-w-36 rounded-xl border border-edge bg-surface-overlay p-1 shadow-popover">
            <DropdownMenu.Item className={itemClass} disabled={busy} onSelect={onEdit}><Pencil className="size-4" aria-hidden="true" />{zh ? '修改' : 'Edit'}</DropdownMenu.Item>
            <DropdownMenu.Item className={itemClass} disabled={busy} onSelect={() => setConfirming(true)}><Trash2 className="size-4" aria-hidden="true" />{zh ? '删除' : 'Delete'}</DropdownMenu.Item>
          </DropdownMenu.Content>
        </DropdownMenu.Portal>
      </DropdownMenu.Root>
      <Dialog.Portal>
        <Dialog.Overlay className="fixed inset-0 z-[110] bg-scrim" />
        <Dialog.Content className="fixed left-1/2 top-1/2 z-[120] flex h-[min(22rem,calc(100dvh-2rem))] w-[min(28rem,calc(100vw-2rem))] -translate-x-1/2 -translate-y-1/2 flex-col overflow-hidden rounded-2xl border border-edge bg-surface-overlay shadow-popover">
          <header className="shrink-0 border-b border-edge px-5 py-4">
            <Dialog.Title className="font-semibold text-fg">{zh ? '删除这条内容？' : 'Delete this item?'}</Dialog.Title>
            <Dialog.Description className="mt-1 text-sm leading-6 text-fg-muted">{zh ? '删除后将不再使用这条记忆，原始对话和文件会保留。' : 'This memory will no longer be used. Original conversations and files are kept.'}</Dialog.Description>
          </header>
          <p className="min-h-0 flex-1 overflow-y-auto whitespace-pre-wrap break-words px-5 py-4 text-sm leading-6 text-fg">{statement}</p>
          <footer className="flex shrink-0 justify-end gap-2 border-t border-edge px-5 py-3">
            <Dialog.Close asChild><Button variant="ghost">{zh ? '取消' : 'Cancel'}</Button></Dialog.Close>
            <Button disabled={busy} onClick={() => { setConfirming(false); onDelete(); }}>{zh ? '删除' : 'Delete'}</Button>
          </footer>
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  );
}
