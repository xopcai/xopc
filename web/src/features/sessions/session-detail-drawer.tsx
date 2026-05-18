import * as Dialog from '@radix-ui/react-dialog';
import { X } from 'lucide-react';

import { Button } from '@/components/ui/button';
import type { SessionDetail } from '@/features/sessions/session.types';
import { AgentAvatarDisplay } from '@/features/settings/agents/agent-avatar-display';
import { cn } from '@/lib/cn';
import { SETTINGS_SHELL_CONTENT_Z, SETTINGS_SHELL_OVERLAY_Z } from '@/lib/settings-shell-dialog-layer';

function previewContent(content: string | unknown[]): string {
  if (typeof content === 'string') {
    return content.length > 2000 ? `${content.slice(0, 2000)}…` : content;
  }
  try {
    const s = JSON.stringify(content, null, 2);
    return s.length > 2000 ? `${s.slice(0, 2000)}…` : s;
  } catch {
    return String(content);
  }
}

export function SessionDetailDrawer({
  open,
  loading,
  session,
  sessionAgentId,
  sessionAgentAvatar,
  labels,
  onClose,
  onArchive,
  onUnarchive,
  onPin,
  onUnpin,
  onExport,
  onDelete,
}: {
  open: boolean;
  loading: boolean;
  session: SessionDetail | null;
  sessionAgentId?: string;
  sessionAgentAvatar?: string;
  labels: {
    close: string;
    detailLoading: string;
    detailMessages: string;
    detailExport: string;
    archive: string;
    unarchive: string;
    pin: string;
    unpin: string;
    delete: string;
    unnamedSession: string;
  };
  onClose: () => void;
  onArchive: () => void;
  onUnarchive: () => void;
  onPin: () => void;
  onUnpin: () => void;
  onExport: () => void;
  onDelete: () => void;
}) {
  const isArchived = session?.status === 'archived';
  const isPinned = session?.status === 'pinned';

  return (
    <Dialog.Root open={open} onOpenChange={(v) => !v && onClose()}>
      <Dialog.Portal>
        <Dialog.Overlay
          className={cn('xopc-dialog-overlay fixed inset-0 bg-scrim', SETTINGS_SHELL_OVERLAY_Z)}
        />
        <Dialog.Content
          className={cn(
            'xopc-drawer-right fixed right-0 top-0 flex size-full max-w-lg flex-col border-l border-edge bg-surface-panel shadow-popover outline-none',
            SETTINGS_SHELL_CONTENT_Z,
            'dark:border-edge',
          )}
          aria-describedby={undefined}
        >
          <div className="flex min-w-0 shrink-0 items-center justify-between gap-2 border-b border-edge px-4 py-3 dark:border-edge">
            <div className="flex min-w-0 flex-1 items-center gap-3">
              {session && sessionAgentId ? (
                <AgentAvatarDisplay
                  agentId={sessionAgentId}
                  avatar={sessionAgentAvatar}
                  size={40}
                  className="size-10 shrink-0 ring-1 ring-edge/60 dark:ring-edge"
                />
              ) : null}
              <Dialog.Title className="min-w-0 flex-1 truncate text-base font-semibold tracking-tight text-fg">
                {session?.name?.trim() || labels.unnamedSession}
              </Dialog.Title>
            </div>
            <Dialog.Close asChild>
              <Button type="button" variant="ghost" className="size-9 shrink-0 p-0" aria-label={labels.close}>
                <X className="size-5" strokeWidth={1.75} />
              </Button>
            </Dialog.Close>
          </div>

          <div className="min-h-0 flex-1 overflow-y-auto px-4 py-3">
            {loading ? (
              <p className="text-sm text-fg-muted">{labels.detailLoading}</p>
            ) : session ? (
              <>
                <dl className="mb-4 grid gap-2 text-xs text-fg-muted">
                  <div>
                    <dt className="text-fg-disabled">Key</dt>
                    <dd className="mt-0.5 break-all font-mono text-fg">{session.key}</dd>
                  </div>
                  <div className="flex flex-wrap gap-4">
                    <span>
                      {session.messageCount} msgs · {session.estimatedTokens} tok
                    </span>
                  </div>
                </dl>
                <h3 className="mb-2 text-xs font-medium uppercase tracking-wide text-fg-subtle">
                  {labels.detailMessages}
                </h3>
                <ul className="space-y-3">
                  {session.messages.map((msg) => (
                    <li
                      key={`${msg.timestamp ?? ''}-${msg.role}-${previewContent(msg.content).slice(0, 24)}`}
                      className="rounded-lg border border-edge-subtle bg-surface-hover/50 p-2 dark:border-edge"
                    >
                      <div className="mb-1 text-[10px] font-medium uppercase text-fg-subtle">{msg.role}</div>
                      <pre className="max-h-40 overflow-auto whitespace-pre-wrap break-words font-mono text-[11px] leading-relaxed text-fg-muted">
                        {previewContent(msg.content)}
                      </pre>
                    </li>
                  ))}
                </ul>
              </>
            ) : null}
          </div>

          <div className="shrink-0 border-t border-edge px-4 py-3 dark:border-edge">
            <div className="flex flex-wrap gap-2">
              <Button type="button" variant="secondary" className="text-sm" onClick={onExport}>
                {labels.detailExport}
              </Button>
              {isArchived ? (
                <Button type="button" variant="secondary" className="text-sm" onClick={onUnarchive}>
                  {labels.unarchive}
                </Button>
              ) : (
                <Button type="button" variant="secondary" className="text-sm" onClick={onArchive}>
                  {labels.archive}
                </Button>
              )}
              {isPinned ? (
                <Button type="button" variant="secondary" className="text-sm" onClick={onUnpin}>
                  {labels.unpin}
                </Button>
              ) : (
                <Button type="button" variant="secondary" className="text-sm" onClick={onPin}>
                  {labels.pin}
                </Button>
              )}
              <Button
                type="button"
                variant="secondary"
                className="text-sm text-red-600 hover:bg-red-50 dark:text-red-400 dark:hover:bg-red-950/40"
                onClick={onDelete}
              >
                {labels.delete}
              </Button>
            </div>
          </div>
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  );
}
