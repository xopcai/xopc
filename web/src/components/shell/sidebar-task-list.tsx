import * as Dialog from '@radix-ui/react-dialog';
import * as Popover from '@radix-ui/react-popover';
import { ClipboardCopy, Loader2, MoreHorizontal, Pencil, Pin, PinOff, Trash2 } from 'lucide-react';
import { memo, useCallback, useEffect, useMemo, useRef, useState, type UIEvent } from 'react';
import { Link, useLocation, useNavigate } from 'react-router-dom';
import useSWRInfinite from 'swr/infinite';

import { Button } from '@/components/ui/button';
import { isWebUiSessionKey } from '@/features/chat/session-manager';
import {
  deleteSession,
  listSessions,
  pinSession,
  renameSession,
  unpinSession,
} from '@/features/sessions/session-api';
import type { SessionMetadata } from '@/features/sessions/session.types';
import { messages } from '@/i18n/messages';
import { formControlBorderFocusClass } from '@/lib/form-field-width';
import { cn } from '@/lib/cn';
import { useGatewayStore } from '@/stores/gateway-store';
import { useLocaleStore } from '@/stores/locale-store';

const PAGE_SIZE = 20;

type SidebarTaskPage = {
  items: SessionMetadata[];
  hasMore: boolean;
};

function sessionTitle(s: SessionMetadata, unnamedLabel: string): string {
  return s.name?.trim() || unnamedLabel;
}

/** Active chat session key from `/chat/:key` (excludes `/chat/new`). */
function chatSessionKeyFromPath(pathname: string): string | undefined {
  const m = /^\/chat\/([^/]+)$/.exec(pathname);
  if (!m) return undefined;
  const seg = decodeURIComponent(m[1]);
  if (seg === 'new') return undefined;
  return seg;
}

function interpolate(template: string, params: Record<string, string | number>): string {
  return template.replace(/\{\{(\w+)\}\}/g, (_, key) => String(params[key] ?? ''));
}

function rowShellClass(isActive: boolean): string {
  return cn(
    // `px-4` list + `pl-3` row = same inset as nav `px-4` + item `px-3` → aligns with menu icons.
    'group flex w-full min-w-0 items-center gap-0.5 rounded-xl pl-3 pr-1 text-left text-sm font-medium leading-5 transition-colors duration-200 ease-out',
    'focus-within:outline-none',
    isActive ? 'bg-surface-active text-fg' : 'text-fg-muted hover:bg-surface-hover hover:text-fg',
  );
}

const SidebarTaskRow = memo(function SidebarTaskRow({
  session,
  isActive,
  onNavigate,
  mutate,
  onRequestRename,
  onRequestDelete,
  sb,
  sess,
  defaultUnnamedTitle,
}: {
  session: SessionMetadata;
  isActive: boolean;
  onNavigate?: () => void;
  mutate: () => void;
  onRequestRename: (key: string) => void;
  onRequestDelete: (key: string) => void;
  sb: ReturnType<typeof messages>['sidebar'];
  sess: ReturnType<typeof messages>['sessions'];
  defaultUnnamedTitle: string;
}) {
  const [menuOpen, setMenuOpen] = useState(false);
  const title = sessionTitle(session, defaultUnnamedTitle);
  const isPinned = session.status === 'pinned';

  const handlePinToggle = async () => {
    try {
      if (isPinned) {
        await unpinSession(session.key);
      } else {
        await pinSession(session.key);
      }
      setMenuOpen(false);
      void mutate();
    } catch {
      /* optional toast */
    }
  };

  const copyChatId = async () => {
    try {
      await navigator.clipboard.writeText(session.key);
    } catch {
      /* ignore */
    }
    setMenuOpen(false);
  };

  return (
    <div className={rowShellClass(isActive)}>
      <Link
        to={`/chat/${encodeURIComponent(session.key)}`}
        className="min-w-0 flex-1 truncate rounded-xl py-1 outline-none focus-visible:ring-2 focus-visible:ring-accent focus-visible:ring-offset-2 focus-visible:ring-offset-surface-base"
        title={title}
        onClick={() => onNavigate?.()}
      >
        {title}
      </Link>
      <Popover.Root open={menuOpen} onOpenChange={setMenuOpen}>
        <Popover.Trigger asChild>
          <button
            type="button"
            className={cn(
              'relative z-10 flex size-8 shrink-0 items-center justify-center rounded-lg text-fg-muted transition-opacity',
              'opacity-0 group-hover:opacity-100 focus:opacity-100',
              menuOpen && 'opacity-100',
              'hover:bg-surface-hover hover:text-fg',
              'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent focus-visible:ring-offset-2 focus-visible:ring-offset-surface-base',
            )}
            aria-label={sb.taskSessionMenuAria}
            title={sb.taskSessionMenuAria}
            aria-expanded={menuOpen}
          >
            <MoreHorizontal className="size-4" strokeWidth={2} aria-hidden />
          </button>
        </Popover.Trigger>
        <Popover.Portal>
          <Popover.Content
            className="z-50 w-[9.25rem] rounded-lg border border-edge bg-surface-panel p-1 shadow-elevated dark:border-edge"
            side="bottom"
            align="end"
            sideOffset={4}
            collisionPadding={12}
            onCloseAutoFocus={(e) => e.preventDefault()}
          >
            <button
              type="button"
              className="flex w-full items-center gap-1.5 rounded-md px-2 py-1.5 text-left text-xs font-medium leading-snug text-fg transition-colors hover:bg-surface-hover"
              onClick={() => {
                setMenuOpen(false);
                onRequestRename(session.key);
              }}
            >
              <Pencil className="size-3.5 shrink-0" strokeWidth={1.75} aria-hidden />
              {sb.taskRename}
            </button>
            <button
              type="button"
              className="flex w-full items-center gap-1.5 rounded-md px-2 py-1.5 text-left text-xs font-medium leading-snug text-fg transition-colors hover:bg-surface-hover"
              onClick={() => void handlePinToggle()}
            >
              {isPinned ? (
                <PinOff className="size-3.5 shrink-0" strokeWidth={1.75} aria-hidden />
              ) : (
                <Pin className="size-3.5 shrink-0" strokeWidth={1.75} aria-hidden />
              )}
              {isPinned ? sess.unpin : sess.pin}
            </button>
            <button
              type="button"
              className="flex w-full items-center gap-1.5 rounded-md px-2 py-1.5 text-left text-xs font-medium leading-snug text-fg transition-colors hover:bg-surface-hover"
              onClick={() => void copyChatId()}
            >
              <ClipboardCopy className="size-3.5 shrink-0" strokeWidth={1.75} aria-hidden />
              {sb.taskCopyChatId}
            </button>
            <button
              type="button"
              className="flex w-full items-center gap-1.5 rounded-md px-2 py-1.5 text-left text-xs font-medium leading-snug text-red-600 transition-colors hover:bg-surface-hover dark:text-red-400"
              onClick={() => {
                setMenuOpen(false);
                onRequestDelete(session.key);
              }}
            >
              <Trash2 className="size-3.5 shrink-0" strokeWidth={1.75} aria-hidden />
              {sb.taskDeleteTask}
            </button>
          </Popover.Content>
        </Popover.Portal>
      </Popover.Root>
    </div>
  );
});

export function SidebarTaskList({ onNavigate }: { onNavigate?: () => void }) {
  const language = useLocaleStore((s) => s.language);
  const m = messages(language);
  const sb = m.sidebar;
  const sess = m.sessions;
  const token = useGatewayStore((s) => s.token);
  const openTokenDialog = useGatewayStore((s) => s.openTokenDialog);
  const { pathname } = useLocation();
  const navigate = useNavigate();

  const [renameKey, setRenameKey] = useState<string | null>(null);
  const [renameDraft, setRenameDraft] = useState('');
  const [deleteKey, setDeleteKey] = useState<string | null>(null);
  const lastActiveSessionKeyRef = useRef<string | null>(null);

  const { data, size, setSize, isValidating, mutate } = useSWRInfinite<SidebarTaskPage>(
    (pageIndex, previousPageData) => {
      if (!token) return null;
      if (previousPageData && !previousPageData.hasMore) return null;
      return ['sidebar-tasks', token, pageIndex] as const;
    },
    async ([, , pageIndex]: readonly ['sidebar-tasks', string, number]) => {
      const offset = pageIndex * PAGE_SIZE;
      const result = await listSessions({ limit: PAGE_SIZE, offset });
      return {
        items: result.items.filter((s) => isWebUiSessionKey(s.key)),
        hasMore: result.hasMore,
      };
    },
    { revalidateOnFocus: true },
  );

  const items = useMemo(() => {
    const pages = data ?? [];
    const out: SessionMetadata[] = [];
    const seen = new Set<string>();
    for (const p of pages) {
      for (const s of p.items) {
        if (!seen.has(s.key)) {
          seen.add(s.key);
          out.push(s);
        }
      }
    }
    return out;
  }, [data]);

  const loadingMore = Boolean(data && size > data.length);
  const lastPage = data?.[data.length - 1];
  const hasMorePages = lastPage?.hasMore ?? false;
  const loadingFirst = Boolean(token && !data && isValidating);

  const onScroll = useCallback(
    (e: UIEvent<HTMLDivElement>) => {
      const el = e.currentTarget;
      if (!hasMorePages || loadingMore) return;
      const { scrollTop, scrollHeight, clientHeight } = el;
      if (scrollHeight - scrollTop - clientHeight > 100) return;
      void setSize((s) => s + 1);
    },
    [hasMorePages, loadingMore, setSize],
  );

  useEffect(() => {
    if (!token) return;
    const onSessionUpdated = () => {
      void mutate();
    };
    window.addEventListener('session-updated', onSessionUpdated as EventListener);
    window.addEventListener('session-created', onSessionUpdated as EventListener);
    return () => {
      window.removeEventListener('session-updated', onSessionUpdated as EventListener);
      window.removeEventListener('session-created', onSessionUpdated as EventListener);
    };
  }, [token, mutate]);

  // If a server page has no web UI sessions after filtering, fetch the next page until we have rows or run out.
  useEffect(() => {
    if (!token || !data?.length || loadingMore) return;
    if (items.length > 0) return;
    if (!lastPage?.hasMore) return;
    void setSize((s) => s + 1);
  }, [token, data, items.length, loadingMore, lastPage?.hasMore, setSize]);

  const activeSessionKey = chatSessionKeyFromPath(pathname);

  // Ensure sidebar list reflects newly created/selected sessions immediately.
  // Session SSE events can be delayed or absent until later turn metadata updates.
  useEffect(() => {
    if (!token || !activeSessionKey) return;
    if (lastActiveSessionKeyRef.current === null) {
      lastActiveSessionKeyRef.current = activeSessionKey;
      return;
    }
    if (lastActiveSessionKeyRef.current === activeSessionKey) return;
    lastActiveSessionKeyRef.current = activeSessionKey;
    void mutate();
  }, [token, activeSessionKey, mutate]);

  const openRename = useCallback((key: string) => {
    const row = items.find((s) => s.key === key);
    setRenameKey(key);
    setRenameDraft(row?.name?.trim() ?? '');
  }, [items]);

  const runRename = async () => {
    if (!renameKey) return;
    const name = renameDraft.trim();
    if (!name) return;
    try {
      await renameSession(renameKey, name);
      setRenameKey(null);
      void mutate();
    } catch {
      /* optional toast */
    }
  };

  const runDelete = async (key: string) => {
    try {
      await deleteSession(key);
      if (activeSessionKey === key) {
        navigate('/chat/new');
      }
      void mutate();
    } catch {
      /* optional toast */
    }
  };

  const renameTarget = renameKey ? items.find((s) => s.key === renameKey) : undefined;

  if (!token) {
    return (
      <div className="flex min-h-0 flex-1 flex-col">
        <div className="flex flex-col gap-1.5 px-4 pt-2">
          <div className="pl-3 text-xs font-normal leading-5 text-fg-subtle">{sb.tasksHeading}</div>
          <div className="rounded-xl bg-surface-panel px-3 py-3">
            <p className="text-xs leading-relaxed text-fg-muted">{sb.taskListNeedToken}</p>
            <Button
              type="button"
              variant="secondary"
              className="mt-3 h-8 w-full text-xs font-medium"
              onClick={() => {
                openTokenDialog();
                onNavigate?.();
              }}
            >
              {sb.taskListAddToken}
            </Button>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <div
        className={cn(
          'app-sidebar-nav-scroll min-h-0 flex-1 overflow-y-auto overscroll-y-contain',
          'pb-2',
        )}
        onScroll={onScroll}
      >
        <div className="sticky top-0 z-[1] bg-surface-base px-4 pb-1 pt-2">
          <div className="pl-3 text-xs font-normal leading-5 text-fg-subtle">{sb.tasksHeading}</div>
        </div>

        {loadingFirst ? (
          <div className="flex justify-center py-6">
            <Loader2 className="size-5 animate-spin text-fg-subtle" strokeWidth={1.75} aria-hidden />
          </div>
        ) : items.length > 0 ? (
          <div className="flex flex-col gap-0.5 px-4">
            {items.map((session) => (
              <SidebarTaskRow
                key={session.key}
                session={session}
                isActive={activeSessionKey === session.key}
                onNavigate={onNavigate}
                mutate={mutate}
                onRequestRename={openRename}
                onRequestDelete={setDeleteKey}
                sb={sb}
                sess={sess}
                defaultUnnamedTitle={m.chat.newSession}
              />
            ))}
          </div>
        ) : null}

        {loadingMore ? (
          <div className="flex justify-center py-2" aria-busy>
            <Loader2 className="size-4 animate-spin text-fg-subtle" strokeWidth={1.75} aria-hidden />
          </div>
        ) : null}
      </div>

      <Dialog.Root open={renameKey !== null} onOpenChange={(o) => !o && setRenameKey(null)}>
        <Dialog.Portal>
          <Dialog.Overlay className="xopcbot-dialog-overlay fixed inset-0 z-[60] bg-scrim" />
          <Dialog.Content className="xopcbot-dialog-content fixed left-1/2 top-1/2 z-[60] w-[min(100%-2rem,24rem)] -translate-x-1/2 -translate-y-1/2 rounded-xl border border-edge bg-surface-panel p-4 shadow-xl dark:border-edge">
            <Dialog.Title className="text-base font-semibold text-fg">{sb.taskRenameTitle}</Dialog.Title>
            <label className="mt-3 block text-xs font-medium text-fg-subtle" htmlFor="sidebar-rename-input">
              {sb.taskRenamePlaceholder}
            </label>
            <input
              id="sidebar-rename-input"
              type="text"
              value={renameDraft}
              onChange={(e) => setRenameDraft(e.target.value)}
              className={cn(
                'mt-1.5 w-full rounded-lg border border-edge bg-surface-base px-3 py-2 text-sm text-fg',
                formControlBorderFocusClass,
                'dark:border-edge',
              )}
              placeholder={renameTarget ? sessionTitle(renameTarget, m.chat.newSession) : ''}
              onKeyDown={(e) => {
                if (e.key === 'Enter') {
                  e.preventDefault();
                  void runRename();
                }
              }}
            />
            <div className="mt-4 flex justify-end gap-2">
              <Button type="button" variant="secondary" onClick={() => setRenameKey(null)}>
                {sb.taskRenameCancel}
              </Button>
              <Button type="button" variant="primary" onClick={() => void runRename()} disabled={!renameDraft.trim()}>
                {sb.taskRenameSave}
              </Button>
            </div>
          </Dialog.Content>
        </Dialog.Portal>
      </Dialog.Root>

      <Dialog.Root open={deleteKey !== null} onOpenChange={(o) => !o && setDeleteKey(null)}>
        <Dialog.Portal>
          <Dialog.Overlay className="xopcbot-dialog-overlay fixed inset-0 z-[60] bg-scrim" />
          <Dialog.Content className="xopcbot-dialog-content fixed left-1/2 top-1/2 z-[60] w-[min(100%-2rem,24rem)] -translate-x-1/2 -translate-y-1/2 rounded-xl border border-edge bg-surface-panel p-4 shadow-xl dark:border-edge">
            <Dialog.Title className="text-base font-semibold text-fg">{sess.deleteSessionTitle}</Dialog.Title>
            <p className="mt-2 text-sm text-fg-muted">
              {deleteKey
                ? interpolate(sess.deleteSessionMessage, {
                    name: items.find((x) => x.key === deleteKey)?.name?.trim() || m.chat.newSession,
                  })
                : ''}
            </p>
            <div className="mt-4 flex justify-end gap-2">
              <Button type="button" variant="secondary" onClick={() => setDeleteKey(null)}>
                {sess.cancel}
              </Button>
              <Button
                type="button"
                variant="primary"
                className="bg-red-600 hover:bg-red-700"
                onClick={() => {
                  if (deleteKey) void runDelete(deleteKey);
                  setDeleteKey(null);
                }}
              >
                {sess.delete}
              </Button>
            </div>
          </Dialog.Content>
        </Dialog.Portal>
      </Dialog.Root>
    </div>
  );
}
