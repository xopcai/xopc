import { useCallback, useState } from 'react';
import { AlertCircle, Copy, ExternalLink, File, FolderOpen, RotateCw, Settings, X } from 'lucide-react';

import type { WorkspaceFileLinkTarget } from '@/components/markdown/internal-links';
import { Skeleton } from '@/components/ui/skeleton';
import { resolveFileReferenceAction, type WorkspaceFileReference } from '@/features/workspace/workspace-api';
import { messages } from '@/i18n/messages';
import { cn } from '@/lib/cn';
import { copyTextToClipboard } from '@/lib/copy-to-clipboard';
import { isElectron } from '@/lib/electron-env';
import { interaction } from '@/lib/interaction';
import { useLocaleStore } from '@/stores/locale-store';

export type FileReferencePreview =
  | { status: 'loading'; target: WorkspaceFileLinkTarget }
  | { status: 'ready'; target: WorkspaceFileLinkTarget; ref: WorkspaceFileReference; retry?: () => void }
  | { status: 'error'; target: WorkspaceFileLinkTarget; message: string; retry: () => void };

export function FileReferencePreviewPanel({
  resolution,
  conversationId,
  onClose,
}: {
  resolution: FileReferencePreview;
  conversationId?: string | null;
  onClose: () => void;
}) {
  const language = useLocaleStore((s) => s.language);
  const m = messages(language).chat.fileReference;
  const [copied, setCopied] = useState(false);
  const [actionError, setActionError] = useState('');
  const [actionPending, setActionPending] = useState(false);
  const canUseShell = isElectron() && Boolean(window.electronAPI?.shell);
  const targetPath = resolution.target.path;
  const ref = resolution.status === 'ready' ? resolution.ref : null;
  const displayName = ref?.displayName ?? targetPath.split(/[\\/]/).pop() ?? targetPath;
  const displayPath = ref?.absolutePath ?? ref?.workspaceRelativePath ?? targetPath;

  const copyPath = useCallback(() => {
    void copyTextToClipboard(displayPath).then((ok) => {
      if (!ok) return;
      setCopied(true);
      window.setTimeout(() => setCopied(false), 2000);
    });
  }, [displayPath]);

  const runAction = async (action: 'openExternal' | 'revealInFolder') => {
    const shell = window.electronAPI?.shell;
    if (!ref?.fileRefId || !canUseShell || !shell || actionPending) return;
    setActionError('');
    setActionPending(true);
    try {
      const target = await resolveFileReferenceAction(ref.fileRefId, action, { conversationId: conversationId?.trim() || undefined });
      if (action === 'openExternal') {
        const result = await shell.openPath(target.absolutePath);
        if (!result.ok) setActionError(result.error);
      } else {
        const result = await shell.showItemInFolder(target.absolutePath);
        if (!result.success) setActionError(m.resolveFailedDescription);
      }
    } catch (error) { setActionError(error instanceof Error ? error.message : String(error)); }
    finally { setActionPending(false); }
  };

  if (resolution.status === 'loading') {
    return <div aria-label={m.resolvingDescription} aria-busy="true" className="flex flex-1 flex-col gap-4 bg-surface-panel p-4">
      <p className="truncate text-sm font-medium text-fg">{displayName}</p>
      <Skeleton className="h-5 w-1/3" />
      <Skeleton className="h-32 w-full rounded-xl" />
      <Skeleton className="h-4 w-2/3" />
    </div>;
  }

  const tone =
    resolution.status === 'ready' && resolution.ref.exists && resolution.ref.scope !== 'missing'
      ? 'border-edge-subtle bg-surface-panel'
      : 'border-warning/30 bg-warning/5';

  return (
    <div className={cn('m-4 flex min-w-0 flex-col gap-1.5 rounded-lg border px-2.5 py-2 text-xs', tone)}>
      <div className="flex min-w-0 items-center gap-1.5">
        {resolution.status === 'error' || ref?.scope === 'missing' || ref?.scope === 'invalid' ? (
          <AlertCircle className="size-3.5 shrink-0 text-warning" strokeWidth={1.75} aria-hidden />
        ) : (
          <File className="size-3.5 shrink-0 text-accent" strokeWidth={1.75} aria-hidden />
        )}
        <span className="min-w-0 truncate font-medium">{displayName}</span>
        <button
          type="button"
          onClick={onClose}
          className={cn('ml-auto inline-flex size-5 shrink-0 items-center justify-center rounded text-fg-muted hover:bg-surface-hover hover:text-fg', interaction.focusRingPanel)}
          aria-label={m.closeActions}
        >
          <X className="size-3" strokeWidth={1.75} aria-hidden />
        </button>
      </div>
      <p className="line-clamp-2 break-all text-[11px] leading-snug text-fg-muted">
        {resolution.status === 'error' ? resolution.message
          : ref?.scope === 'missing' ? m.missingDescription
            : ref?.scope === 'invalid' ? m.invalidDescription
              : canUseShell ? m.externalDescription : m.browserExternalDescription}
      </p>
      <div className="flex flex-wrap items-center gap-1 pt-0.5">
        {resolution.retry ? <button type="button" className={fileActionButtonClass} onClick={resolution.retry}>
          <RotateCw className="size-3" aria-hidden /><span>{language === 'zh' ? '重试' : 'Retry'}</span>
        </button> : null}
        {canUseShell && ref?.capabilities.includes('openExternal') ? (
          <button type="button" className={fileActionButtonClass} disabled={actionPending} onClick={() => void runAction('openExternal')}>
            <ExternalLink className="size-3" aria-hidden /><span>{m.openExternal}</span>
          </button>
        ) : null}
        {canUseShell && ref?.capabilities.includes('revealInFolder') ? (
          <button type="button" className={fileActionButtonClass} disabled={actionPending} onClick={() => void runAction('revealInFolder')}>
            <FolderOpen className="size-3" aria-hidden /><span>{m.revealInFolder}</span>
          </button>
        ) : null}
        {ref?.manageRoute ? (
          <a className={fileActionButtonClass} href={`#${ref.manageRoute}`}>
            <Settings className="size-3" aria-hidden /><span>{messages(language).nav.settings}</span>
          </a>
        ) : null}
        <button type="button" className={fileActionButtonClass} onClick={copyPath}>
          <Copy className="size-3" strokeWidth={1.75} aria-hidden />
          <span>{copied ? messages(language).chat.messageCopied : m.copyPath}</span>
        </button>
      </div>
      {actionError ? <p role="alert" className="text-warning">{actionError}</p> : null}
    </div>
  );
}

const fileActionButtonClass = cn(
  'inline-flex items-center gap-1 rounded-md px-1.5 py-0.5 text-[11px] text-fg-muted transition-colors hover:bg-surface-hover hover:text-fg',
  interaction.focusRingPanel,
  interaction.press,
);

