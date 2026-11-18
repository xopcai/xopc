import * as DropdownMenu from '@radix-ui/react-dropdown-menu';
import { ChevronDown, Pencil, Pin, PinOff, Search, Share2 } from 'lucide-react';
import { useRef, useState } from 'react';

import { APP_CHROME_NO_DRAG_CLASS } from '@/components/shell/app-chrome';
import { showComposerNotification } from '@/features/chat/composer/composer-notifications';
import { pinSession, unpinSession } from '@/features/sessions/session-api';
import { SessionRenameDialog } from '@/features/sessions/session-rename-dialog';
import { SessionShareButton } from '@/features/shares/session-share-button';
import { messages } from '@/i18n/messages';
import { cn } from '@/lib/cn';
import { useLocaleStore } from '@/stores/locale-store';

const menuItemClass = 'flex cursor-default items-center gap-3 rounded-lg px-3 py-2 text-fg outline-none data-[highlighted]:bg-surface-hover data-[disabled]:opacity-40';

export function ChatTitleMenu({ title, centered, conversationId, pinned, hasMessages, onFindOpen }: {
  title: string;
  centered: boolean;
  conversationId: string | null;
  pinned?: boolean;
  hasMessages: boolean;
  onFindOpen?: () => void;
}) {
  const language = useLocaleStore((state) => state.language);
  const m = messages(language);
  const triggerRef = useRef<HTMLButtonElement>(null);
  const afterMenuClose = useRef<(() => void) | null>(null);
  const [renameOpen, setRenameOpen] = useState(false);
  const [shareOpen, setShareOpen] = useState(false);
  const [pinning, setPinning] = useState(false);
  const canEdit = Boolean(conversationId && pinned !== undefined);
  const canShare = Boolean(conversationId && hasMessages);
  const PinIcon = pinned ? PinOff : Pin;

  const togglePin = async () => {
    if (!conversationId || pinning) return;
    setPinning(true);
    try {
      await (pinned ? unpinSession : pinSession)(conversationId);
    } catch {
      showComposerNotification('warning', m.sessions.pinFailed);
    } finally {
      setPinning(false);
    }
  };

  return (
    <>
      <h1 className={cn(
        'flex min-w-0 flex-1 text-[0.9375rem] font-semibold leading-5 tracking-tight text-fg',
        centered && 'md:justify-center',
      )}>
        <DropdownMenu.Root modal={false}>
          <DropdownMenu.Trigger asChild>
            <button
              ref={triggerRef}
              type="button"
              title={title}
              className={cn(
                'inline-flex h-8 min-w-0 max-w-full items-center gap-1.5 rounded-lg px-2 text-left transition-colors',
                'hover:bg-surface-hover data-[state=open]:bg-surface-hover focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-accent',
                APP_CHROME_NO_DRAG_CLASS,
              )}
            >
              <span className="min-w-0 truncate">{title}</span>
              <ChevronDown className="size-4 shrink-0 text-fg-muted" aria-hidden />
            </button>
          </DropdownMenu.Trigger>
          <DropdownMenu.Portal>
            <DropdownMenu.Content
              onCloseAutoFocus={(event) => {
                const action = afterMenuClose.current;
                if (!action) return;
                event.preventDefault();
                afterMenuClose.current = null;
                triggerRef.current?.focus();
                action();
              }}
              align="start"
              sideOffset={4}
              collisionPadding={8}
              className="workspace-menu z-[125] min-w-60 rounded-xl border border-edge bg-surface-overlay p-1.5 text-sm shadow-popover outline-none"
            >
              {canEdit ? (
                <>
                  <DropdownMenu.Item onSelect={() => { afterMenuClose.current = () => setRenameOpen(true); }} className={menuItemClass}>
                    <Pencil className="size-4 shrink-0 text-fg-muted" aria-hidden />
                    {m.sidebar.taskRename}
                  </DropdownMenu.Item>
                  <DropdownMenu.Item disabled={pinning} onSelect={() => void togglePin()} className={menuItemClass}>
                    <PinIcon className="size-4 shrink-0 text-fg-muted" aria-hidden />
                    {pinned ? m.sessions.unpin : m.sessions.pin}
                  </DropdownMenu.Item>
                  <DropdownMenu.Separator className="my-1 h-px bg-edge-subtle" />
                </>
              ) : null}
              <DropdownMenu.Item disabled={!hasMessages || !onFindOpen} onSelect={() => { afterMenuClose.current = onFindOpen ?? null; }} className={menuItemClass}>
                <Search className="size-4 text-fg-muted" aria-hidden />
                <span className="flex-1">{m.chat.find.input}</span>
                <span className="text-xs text-fg-muted">{window.electronAPI?.platform === 'darwin' ? '⌘F' : 'Ctrl+F'}</span>
              </DropdownMenu.Item>
              <DropdownMenu.Item disabled={!canShare} onSelect={() => { afterMenuClose.current = () => setShareOpen(true); }} className={menuItemClass}>
                <Share2 className="size-4 text-fg-muted" aria-hidden />
                {language === 'zh' ? '分享对话' : 'Share conversation'}
              </DropdownMenu.Item>
            </DropdownMenu.Content>
          </DropdownMenu.Portal>
        </DropdownMenu.Root>
      </h1>
      {conversationId && canEdit && renameOpen ? (
        <SessionRenameDialog
          conversationId={conversationId}
          initialName={title}
          onClose={() => setRenameOpen(false)}
          returnFocusRef={triggerRef}
        />
      ) : null}
      {conversationId && hasMessages ? (
        <SessionShareButton
          conversationId={conversationId}
          hideTrigger
          dialogOpen={shareOpen}
          onDialogOpenChange={setShareOpen}
          returnFocusRef={triggerRef}
        />
      ) : null}
    </>
  );
}
