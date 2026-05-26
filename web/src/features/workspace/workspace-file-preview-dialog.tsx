import { Check, Copy, Download, Eye, FolderOpen, Link2, Loader2, Maximize2, Minimize2, Pencil, X } from 'lucide-react';
import { useCallback, useEffect, useState } from 'react';

import { showComposerNotification } from '@/features/chat/composer/composer-notifications';
import {
  FilePreviewBody,
  getFileExtension,
  getFileName,
  useFilePreviewFullscreen,
  useWorkspaceFilePreviewState,
} from '@/features/file-preview';
import { ShareLinkDialog } from '@/features/shares/share-link-dialog';
import { useShareLink } from '@/features/shares/use-share-link';
import { cn } from '@/lib/cn';
import { copyTextToClipboard } from '@/lib/copy-to-clipboard';
import { interaction } from '@/lib/interaction';
import { messages } from '@/i18n/messages';
import { useLocaleStore } from '@/stores/locale-store';
import { useThemeStore } from '@/stores/theme-store';

function formatWorkspaceFileMtime(mtimeMs: number, language: 'en' | 'zh'): string {
  return new Intl.DateTimeFormat(language === 'zh' ? 'zh-CN' : 'en', {
    dateStyle: 'medium',
    timeStyle: 'short',
  }).format(new Date(mtimeMs));
}

export interface WorkspaceFilePreviewPanelProps {
  filePath: string | null;
  onClose: () => void;
  /** Per-chat session workspace (takes priority over `agentId`). */
  sessionKey?: string;
  /** Chat agent workspace; omit to use gateway default agent root. */
  agentId?: string;
}

export function WorkspaceFilePreviewPanel({
  filePath,
  onClose,
  sessionKey,
  agentId,
}: WorkspaceFilePreviewPanelProps) {
  const language = useLocaleStore((s) => s.language);
  const m = messages(language);
  const resolvedTheme = useThemeStore((s) => s.resolved);

  const state = useWorkspaceFilePreviewState({ filePath, sessionKey, agentId });
  const { rootRef, active, enter, exit } = useFilePreviewFullscreen();
  const { dialogOpen, loading, result, error, createShareLink, handleOpenChange } = useShareLink();
  const [pathCopied, setPathCopied] = useState(false);

  const ext = filePath ? getFileExtension(filePath) : '';
  const name = filePath ? getFileName(filePath) : '';
  const isMd = ext === '.md';
  const isHtml = ext === '.html' || ext === '.htm';

  const handleCopyPath = useCallback(async () => {
    if (!filePath) return;
    const ok = await copyTextToClipboard(filePath);
    if (ok) {
      setPathCopied(true);
      window.setTimeout(() => setPathCopied(false), 2000);
      showComposerNotification('success', m.workspace.pathCopied, undefined, { duration: 2000 });
      return;
    }
    showComposerNotification('warning', m.clipboard.copyFailed, undefined, { duration: 4000 });
  }, [filePath, m.clipboard.copyFailed, m.workspace.pathCopied]);

  const handleShare = useCallback(() => {
    if (!filePath) return;
    const scope =
      sessionKey != null
        ? { sessionKey }
        : agentId?.trim()
          ? { agentId: agentId.trim() }
          : {};
    void createShareLink({ path: filePath, ...scope });
  }, [agentId, createShareLink, filePath, sessionKey]);

  const canPreviewFullscreen = Boolean(filePath && !state.loading && !state.loadError);

  useEffect(() => {
    if (!filePath) void exit();
  }, [filePath, exit]);

  if (!filePath) {
    return null;
  }

  return (
    <>
    <div ref={rootRef} className="flex h-full min-h-0 flex-col bg-surface-panel">
      <div className="flex shrink-0 items-start gap-2 border-b border-edge px-4 py-2 dark:border-edge">
        <div className="min-w-0 flex-1">
          <h2
            className="truncate text-base font-semibold leading-tight tracking-tight text-fg"
            title={name}
          >
            {name}
          </h2>
          {!state.loading && state.mtimeMs != null ? (
            <p
              suppressHydrationWarning
              className="mt-0.5 truncate text-xs leading-tight text-fg-muted"
              title={new Date(state.mtimeMs).toISOString()}
            >
              {m.workspace.lastModified}: {formatWorkspaceFileMtime(state.mtimeMs, language)}
            </p>
          ) : null}
        </div>
        <div className="flex shrink-0 items-center gap-2 pt-0.5">
          {(isMd || (isHtml && state.htmlCodeMode)) && state.saveStatus !== 'idle' ? (
            <span className="shrink-0 text-xs leading-tight text-fg-muted">
              {state.saveStatus === 'saving' ? m.workspace.saving : m.workspace.saved}
            </span>
          ) : null}
          {isMd ? (
            <button
              type="button"
              className="inline-flex size-9 shrink-0 items-center justify-center rounded-md text-fg-muted transition-colors hover:bg-surface-hover hover:text-fg"
              title={state.markdownEditMode ? m.workspace.viewing : m.workspace.edit}
              aria-label={state.markdownEditMode ? m.workspace.viewing : m.workspace.edit}
              onClick={() => state.setMarkdownEditMode((v) => !v)}
            >
              {state.markdownEditMode ? <Eye className="size-4" /> : <Pencil className="size-4" />}
            </button>
          ) : isHtml ? (
            <button
              type="button"
              className="inline-flex size-9 shrink-0 items-center justify-center rounded-md text-fg-muted transition-colors hover:bg-surface-hover hover:text-fg"
              title={state.htmlCodeMode ? m.workspace.preview : m.workspace.edit}
              aria-label={state.htmlCodeMode ? m.workspace.preview : m.workspace.edit}
              onClick={() => state.setHtmlCodeMode((v) => !v)}
            >
              {state.htmlCodeMode ? <Eye className="size-4" /> : <Pencil className="size-4" />}
            </button>
          ) : null}
          {canPreviewFullscreen ? (
            <button
              type="button"
              className={cn(
                'inline-flex size-9 shrink-0 items-center justify-center rounded-md text-fg-muted transition-colors hover:bg-surface-hover hover:text-fg',
                interaction.focusRingPanel,
              )}
              title={active ? m.chat.attachmentPreviewExitFullscreen : m.chat.attachmentPreviewFullscreen}
              aria-label={active ? m.chat.attachmentPreviewExitFullscreen : m.chat.attachmentPreviewFullscreen}
              onClick={() => void (active ? exit() : enter())}
            >
              {active ? <Minimize2 className="size-4" strokeWidth={1.75} /> : <Maximize2 className="size-4" strokeWidth={1.75} />}
            </button>
          ) : null}
          <button
            type="button"
            className={cn(
              'inline-flex size-9 shrink-0 items-center justify-center rounded-md text-fg-muted transition-colors hover:bg-surface-hover hover:text-fg',
              interaction.focusRingPanel,
            )}
            title={m.workspace.copyPath}
            aria-label={m.workspace.copyPath}
            onClick={() => void handleCopyPath()}
          >
            {pathCopied ? <Check className="size-4" /> : <Copy className="size-4" />}
          </button>
          {state.canRevealInFolder ? (
            <button
              type="button"
              className={cn(
                'inline-flex size-9 shrink-0 items-center justify-center rounded-md text-fg-muted transition-colors hover:bg-surface-hover hover:text-fg',
                interaction.focusRingPanel,
              )}
              title={m.workspace.revealInFolder}
              aria-label={m.workspace.revealInFolder}
              onClick={() => void state.onRevealInFolder()}
            >
              <FolderOpen className="size-4" />
            </button>
          ) : null}
          <button
            type="button"
            className="inline-flex size-9 shrink-0 items-center justify-center rounded-md text-fg-muted transition-colors hover:bg-surface-hover hover:text-fg disabled:opacity-50"
            title={m.workspace.shareLink}
            aria-label={m.workspace.shareLink}
            onClick={handleShare}
            disabled={loading}
          >
            {loading ? <Loader2 className="size-4 animate-spin" /> : <Link2 className="size-4" />}
          </button>
          <button
            type="button"
            className="inline-flex size-9 shrink-0 items-center justify-center rounded-md text-fg-muted transition-colors hover:bg-surface-hover hover:text-fg disabled:opacity-50"
            title={m.workspace.download}
            aria-label={m.workspace.download}
            onClick={() => void state.onDownload()}
            disabled={!state.canDownload}
          >
            <Download className="size-4" />
          </button>
          <button
            type="button"
            className="inline-flex size-9 shrink-0 items-center justify-center rounded-md text-fg-muted transition-colors hover:bg-surface-hover hover:text-fg"
            title={m.workspace.close}
            aria-label={m.workspace.close}
            onClick={onClose}
          >
            <X className="size-4" strokeWidth={1.75} />
          </button>
        </div>
      </div>
      <FilePreviewBody
        context="workspace"
        language={language}
        resolvedTheme={resolvedTheme}
        fileKey={filePath}
        fileName={name}
        loading={state.loading}
        loadError={state.loadError}
        previewKind={state.previewKind}
        textContent={state.textContent}
        binaryBuffer={state.binaryBuffer}
        pptxText={state.pptxText}
        pptxTruncated={state.pptxTruncated}
        pptxError={state.pptxError}
        workspaceEditing={{
          markdownEditMode: state.markdownEditMode,
          onSaveMarkdown: state.onSaveMarkdown,
          htmlCodeMode: state.htmlCodeMode,
          onHtmlChange: state.onHtmlChange,
          isDark: resolvedTheme === 'dark',
        }}
        actions={{
          onDownload: () => void state.onDownload(),
          canDownload: state.canDownload,
          onOpenWithSystemApp: () => void state.onOpenWithSystemApp(),
          canOpenWithSystemApp: state.canOpenWithSystemApp,
        }}
      />
    </div>
    <ShareLinkDialog
      open={dialogOpen}
      onOpenChange={handleOpenChange}
      loading={loading}
      error={error}
      result={result}
    />
    </>
  );
}
