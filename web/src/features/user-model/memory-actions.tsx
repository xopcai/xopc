import * as Dialog from '@radix-ui/react-dialog';
import * as DropdownMenu from '@radix-ui/react-dropdown-menu';
import { Bot, Globe2, MoreHorizontal, Pencil, SlidersHorizontal, Trash2 } from 'lucide-react';
import { useState } from 'react';

import { Button } from '@/components/ui/button';

import type { Scope } from './user-model-api';

export function MemoryActions({ language, busy, statement, scope, onEdit, onDelete, onScopeChange }: {
  language: 'en' | 'zh';
  busy: boolean;
  statement: string;
  scope?: Scope;
  onEdit: () => void;
  onDelete: () => void;
  onScopeChange?: (scope: Scope) => void;
}) {
  const [confirming, setConfirming] = useState(false);
  const [scopeOpen, setScopeOpen] = useState(false);
  const zh = language === 'zh';
  const itemClass = 'flex min-h-11 cursor-pointer items-center gap-2 rounded-lg px-3 text-sm text-fg outline-none focus:bg-surface-hover data-[disabled]:pointer-events-none data-[disabled]:opacity-50';
  return <>
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
            {scope && onScopeChange ? <DropdownMenu.Item className={itemClass} disabled={busy} onSelect={() => setScopeOpen(true)}><SlidersHorizontal className="size-4" aria-hidden="true" />{zh ? '作用范围' : 'Where it applies'}</DropdownMenu.Item> : null}
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
    {scope && onScopeChange ? <Dialog.Root open={scopeOpen} onOpenChange={setScopeOpen}>
      <Dialog.Portal>
        <Dialog.Overlay className="fixed inset-0 z-[110] bg-scrim" />
        <Dialog.Content className="fixed left-1/2 top-1/2 z-[120] flex h-[min(25rem,calc(100dvh-2rem))] w-[min(28rem,calc(100vw-2rem))] -translate-x-1/2 -translate-y-1/2 flex-col overflow-hidden rounded-2xl border border-edge bg-surface-overlay shadow-popover">
          <header className="shrink-0 border-b border-edge px-5 py-4">
            <Dialog.Title className="font-semibold text-fg">{zh ? '这条记忆在哪里生效？' : 'Where should this memory apply?'}</Dialog.Title>
            <Dialog.Description className="mt-1 text-sm leading-6 text-fg-muted">{zh ? '你可以让它用于所有协作，或只用于当前助手。' : 'Use it across all work, or keep it only for this assistant.'}</Dialog.Description>
          </header>
          <div className="min-h-0 flex-1 space-y-2 overflow-y-auto p-4">
            {[
              { value: { type: 'global' } as Scope, icon: Globe2, title: zh ? '所有协作' : 'All work', detail: zh ? '任何助手和对话都可按需使用' : 'Available when relevant in any assistant or conversation' },
              { value: { type: 'agent', id: scope.type === 'agent' ? scope.id ?? 'main' : 'main' } as Scope, icon: Bot, title: zh ? '仅当前助手' : 'This assistant only', detail: zh ? '不会分享给其他助手' : 'Not shared with other assistants' },
            ].map(({ value, icon: Icon, title, detail }) => {
              const selected = scope.type === value.type && (scope.id ?? '') === (value.id ?? '');
              return <button key={value.type} type="button" className={`flex min-h-20 w-full items-center gap-3 rounded-xl px-4 py-3 text-left focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent ${selected ? 'bg-surface-active' : 'hover:bg-surface-hover'}`} disabled={busy} onClick={() => { setScopeOpen(false); onScopeChange(value); }}>
                <Icon className="size-5 shrink-0 text-fg-muted" aria-hidden="true" />
                <span className="min-w-0 flex-1"><span className="block text-sm font-medium text-fg">{title}</span><span className="mt-1 block text-xs leading-5 text-fg-muted">{detail}</span></span>
                {selected ? <span className="text-xs font-medium text-accent-fg">{zh ? '当前' : 'Current'}</span> : null}
              </button>;
            })}
          </div>
          <footer className="flex shrink-0 justify-end border-t border-edge px-5 py-3"><Dialog.Close asChild><Button variant="ghost">{zh ? '取消' : 'Cancel'}</Button></Dialog.Close></footer>
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root> : null}
  </>;
}
