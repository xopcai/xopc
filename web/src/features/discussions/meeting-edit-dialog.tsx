import * as Dialog from '@radix-ui/react-dialog';
import { useState } from 'react';

import { Button } from '@/components/ui/button';

export type MeetingEditDraft = {
  kind: 'summary' | 'decisions' | 'actionItems' | 'risks' | 'openQuestions';
  itemId: string; text: string; owner?: string; dueDate?: string; ignored?: boolean;
};

export function MeetingEditDialog({ initial, zh, busy, onClose, onSave }: {
  initial: MeetingEditDraft; zh: boolean; busy: boolean;
  onClose: () => void; onSave: (draft: MeetingEditDraft) => Promise<void>;
}) {
  const [draft, setDraft] = useState(initial);
  return <Dialog.Root open onOpenChange={open => { if (!open && !busy) onClose(); }}><Dialog.Portal>
    <Dialog.Overlay className="xopc-dialog-overlay fixed inset-0 z-[70] bg-scrim backdrop-blur-[2px]" />
    <Dialog.Content aria-describedby={undefined} className="xopc-dialog-content fixed left-1/2 top-1/2 z-[71] flex h-[min(32rem,90dvh)] w-[min(36rem,calc(100vw-2rem))] -translate-x-1/2 -translate-y-1/2 flex-col overflow-hidden rounded-xl border border-edge bg-surface-overlay">
      <header className="border-b border-edge p-4"><Dialog.Title>{zh ? '编辑纪要内容' : 'Edit meeting content'}</Dialog.Title></header>
      <div className="min-h-0 flex-1 space-y-4 overflow-y-auto p-4">
        <p className="text-xs text-fg-muted">{zh ? '人工修改会保留，重新整理不会覆盖。已创建任务保持不变。' : 'Your changes survive regeneration. Existing tasks remain unchanged.'}</p>
        <label className="block text-sm">{zh ? '内容' : 'Content'}<textarea className="mt-1 min-h-32 w-full rounded border border-edge bg-transparent p-2" value={draft.text} onChange={event => setDraft({ ...draft, text: event.target.value })} /></label>
        {draft.kind === 'actionItems' ? <>
          <label className="block text-sm">{zh ? '负责人原话' : 'Owner as stated'}<input className="mt-1 w-full rounded border border-edge bg-transparent p-2" value={draft.owner ?? ''} onChange={event => setDraft({ ...draft, owner: event.target.value })} /></label>
          <label className="block text-sm">{zh ? '期限原话' : 'Date as stated'}<input className="mt-1 w-full rounded border border-edge bg-transparent p-2" value={draft.dueDate ?? ''} onChange={event => setDraft({ ...draft, dueDate: event.target.value })} /></label>
        </> : null}
        {draft.kind !== 'summary' ? <label className="flex items-center gap-2 text-sm"><input type="checkbox" className="ui-checkbox" checked={Boolean(draft.ignored)} onChange={event => setDraft({ ...draft, ignored: event.target.checked })} />{zh ? '忽略此项' : 'Ignore this item'}</label> : null}
      </div>
      <footer className="flex justify-end gap-2 border-t border-edge p-3"><Button disabled={busy} onClick={onClose}>{zh ? '取消' : 'Cancel'}</Button><Button variant="primary" disabled={busy || !draft.text.trim()} onClick={() => void onSave(draft)}>{zh ? '保存修改' : 'Save changes'}</Button></footer>
    </Dialog.Content>
  </Dialog.Portal></Dialog.Root>;
}
