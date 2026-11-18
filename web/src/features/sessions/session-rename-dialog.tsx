import * as Dialog from '@radix-ui/react-dialog';
import { useId, useState, type FormEvent, type RefObject } from 'react';

import { Button } from '@/components/ui/button';
import { renameSession } from '@/features/sessions/session-api';
import { messages } from '@/i18n/messages';
import { cn } from '@/lib/cn';
import { formControlBorderFocusClass } from '@/lib/form-field-width';
import { dispatchSessionTitleUpdated } from '@/lib/provisional-session-title';
import { useLocaleStore } from '@/stores/locale-store';

export function SessionRenameDialog({ conversationId, initialName, onClose, returnFocusRef }: {
  conversationId: string;
  initialName: string;
  onClose: () => void;
  returnFocusRef?: RefObject<HTMLElement | null>;
}) {
  const m = messages(useLocaleStore((state) => state.language));
  const inputId = useId();
  const [draft, setDraft] = useState(initialName);
  const [saving, setSaving] = useState(false);
  const [failed, setFailed] = useState(false);

  const save = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const name = draft.trim();
    if (!name || saving) return;
    setSaving(true);
    setFailed(false);
    try {
      const result = await renameSession(conversationId, name);
      if (!result.renamed) {
        setFailed(true);
        return;
      }
      dispatchSessionTitleUpdated(conversationId, name);
      onClose();
    } catch {
      setFailed(true);
    } finally {
      setSaving(false);
    }
  };

  return (
    <Dialog.Root open onOpenChange={(open) => { if (!open && !saving) onClose(); }}>
      <Dialog.Portal>
        <Dialog.Overlay className="xopc-dialog-overlay fixed inset-0 z-[60] bg-scrim" />
        <Dialog.Content
          aria-describedby={undefined}
          onCloseAutoFocus={(event) => {
            if (!returnFocusRef?.current) return;
            event.preventDefault();
            returnFocusRef.current.focus();
          }}
          className="xopc-dialog-content fixed left-1/2 top-1/2 z-[60] w-[min(24rem,calc(100vw-2rem))] -translate-x-1/2 -translate-y-1/2 rounded-xl border border-edge bg-surface-overlay p-4 shadow-popover"
        >
          <Dialog.Title className="text-base font-semibold text-fg">{m.sidebar.taskRenameTitle}</Dialog.Title>
          <form onSubmit={(event) => void save(event)}>
            <label className="mt-3 block text-xs font-medium text-fg-subtle" htmlFor={inputId}>
              {m.sidebar.taskRenamePlaceholder}
            </label>
            <input
              id={inputId}
              type="text"
              value={draft}
              onChange={(event) => setDraft(event.target.value)}
              readOnly={saving}
              className={cn('mt-1.5 w-full rounded-lg border border-edge-subtle bg-surface-base px-3 py-2 text-sm text-fg', formControlBorderFocusClass)}
              placeholder={m.chat.newSession}
            />
            {failed ? <p role="alert" className="mt-2 text-sm text-danger">{m.sessions.renameFailed}</p> : null}
            <div className="mt-4 flex justify-end gap-2">
              <Dialog.Close asChild>
                <Button type="button" variant="secondary" disabled={saving}>{m.sidebar.taskRenameCancel}</Button>
              </Dialog.Close>
              <Button type="submit" variant="primary" disabled={!draft.trim() || saving}>{m.sidebar.taskRenameSave}</Button>
            </div>
          </form>
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  );
}
