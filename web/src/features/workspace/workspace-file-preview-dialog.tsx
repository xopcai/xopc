import { useCallback, useState } from 'react';
import { createPortal } from 'react-dom';

import { useFilePreviewExpanded } from '@/features/file-preview/use-file-preview-expanded';
import { FilePreview } from '@/features/file-preview/file-preview';
import { Skeleton } from '@/components/ui/skeleton';
import { showComposerNotification } from '@/features/chat/composer/composer-notifications';
import {
  getPreviewFileExtension,
  getPreviewFileName,
  useWorkspacePreviewState,
} from '@/features/preview-runtime';
import { ShareLinkDialog } from '@/features/shares/share-link-dialog';
import { useShareLink } from '@/features/shares/use-share-link';
import { runFileShellAction } from '@/features/workspace/run-file-shell-action';
import { cn } from '@/lib/cn';
import { copyTextToClipboard } from '@/lib/copy-to-clipboard';
import { messages } from '@/i18n/messages';
import { useLocaleStore } from '@/stores/locale-store';
import { useThemeStore } from '@/stores/theme-store';

const WORKSPACE_FILE_MTIME_ZH = new Intl.DateTimeFormat('zh-CN', {
  dateStyle: 'medium',
  timeStyle: 'short',
});
const WORKSPACE_FILE_MTIME_EN = new Intl.DateTimeFormat('en', {
  dateStyle: 'medium',
  timeStyle: 'short',
});

function formatWorkspaceFileMtime(mtimeMs: number, language: 'en' | 'zh'): string {
  return (language === 'zh' ? WORKSPACE_FILE_MTIME_ZH : WORKSPACE_FILE_MTIME_EN).format(
    new Date(mtimeMs),
  );
}

export interface WorkspaceFilePreviewPanelProps {
  filePath: string | null;
  onClose: () => void;
  targetLine?: number | null;
  /** Project workspace root. Takes priority over chat session / agent workspace. */
  projectId?: string;
  /** Per-chat session workspace (takes priority over `agentId`). */
  sessionKey?: string;
  /** Chat agent workspace; omit to use gateway default agent root. */
  agentId?: string;
}

export function WorkspaceFilePreviewPanel({
  filePath,
  onClose,
  targetLine,
  projectId,
  sessionKey,
  agentId,
}: WorkspaceFilePreviewPanelProps) {
  const language = useLocaleStore((s) => s.language);
  const m = messages(language);
  const resolvedTheme = useThemeStore((s) => s.resolved);

  const state = useWorkspacePreviewState({ filePath, projectId, sessionKey, agentId });
  const {
    dialogOpen,
    loading,
    result,
    error,
    pendingParams,
    createShareLink,
    confirmShareLink,
    handleOpenChange,
  } = useShareLink();
  const [pathCopied, setPathCopied] = useState(false);
  const [markdownWordWrap, setMarkdownWordWrap] = useState(false);
  const { expanded, setExpanded } = useFilePreviewExpanded(Boolean(filePath), dialogOpen);

  const ext = filePath ? getPreviewFileExtension(filePath) : '';
  const name = filePath ? getPreviewFileName(filePath) : '';
  const isMd = ext === '.md';
  const isHtml = ext === '.html' || ext === '.htm';

  const handleCopyPath = useCallback(async () => {
    if (!filePath) return;
    const ok = await copyTextToClipboard(filePath);
    if (ok) {
      setPathCopied(true);
      showComposerNotification('success', m.workspace.pathCopied, undefined, { duration: 2500 });
      window.setTimeout(() => setPathCopied(false), 2000);
      return;
    }
    showComposerNotification('warning', m.clipboard.copyFailed, undefined, { duration: 4000 });
  }, [filePath, m.clipboard.copyFailed, m.workspace.pathCopied]);

  const handleShare = useCallback(() => {
    if (!state.fileResourceId) return;
    createShareLink({ fileId: state.fileResourceId, fileName: name });
  }, [createShareLink, name, state.fileResourceId]);

  const handleOpenWithSystemApp = useCallback(async () => {
    await runFileShellAction(
      () => state.onOpenWithSystemApp(),
      m.chat.attachmentPreviewOpenLocalFailed,
    );
  }, [m.chat.attachmentPreviewOpenLocalFailed, state.onOpenWithSystemApp]);

  const handleChooseOpenWithApp = useCallback(async () => {
    await runFileShellAction(
      () => state.onChooseOpenWithApp(),
      m.workspace.openFileFailed,
    );
  }, [m.workspace.openFileFailed, state.onChooseOpenWithApp]);

  const handleOpenWithRecentApp = useCallback(async (appPath: string) => {
    await runFileShellAction(
      () => state.onOpenWithRecentApp(appPath),
      m.workspace.openFileFailed,
    );
  }, [m.workspace.openFileFailed, state.onOpenWithRecentApp]);

  const handleRevealInFolder = useCallback(async () => {
    await runFileShellAction(
      () => state.onRevealInFolder(),
      m.workspace.revealFileFailed,
    );
  }, [m.workspace.revealFileFailed, state.onRevealInFolder]);

  const handleClose = useCallback(() => {
    setExpanded(false);
    onClose();
  }, [onClose]);

  const canExpandPreview = Boolean(filePath && !state.loading && !state.loadError);
  const previewActions = {
    onDownload: () => void state.onDownload(),
    canDownload: state.canDownload,
    onOpenWithSystemApp: () => void handleOpenWithSystemApp(),
    canOpenWithSystemApp: state.canOpenWithSystemApp,
    onChooseOpenWithApp: () => void state.onChooseOpenWithApp(),
    canChooseOpenWithApp: state.canChooseOpenWithApp,
  };

  if (!filePath) {
    return null;
  }

  const previewPanel = (
    <div
      className={cn(
        'flex h-full min-h-0 flex-col bg-surface-panel',
        expanded && 'fixed inset-0 z-[65] h-[100dvh] w-screen',
      )}
    >
      <FilePreview
        header={{
          subtitle: (
            <>
              {!state.loading && state.mtimeMs != null ? (
                <p
                  suppressHydrationWarning
                  className="min-w-0 truncate"
                  title={new Date(state.mtimeMs).toISOString()}
                >
                  {m.workspace.lastModified}: {formatWorkspaceFileMtime(state.mtimeMs, language)}
                  {targetLine ? ` · Line ${targetLine}` : ''}
                </p>
              ) : null}
              {state.loading ? <Skeleton className="h-3.5 w-32" /> : null}
              {(isMd || (isHtml && state.htmlCodeMode)) && state.saveStatus !== 'idle' ? (
                <span className={cn('shrink-0', state.saveStatus === 'error' && 'text-red-600 dark:text-red-400')}>
                  {state.saveStatus === 'saving'
                    ? m.workspace.saving
                    : state.saveStatus === 'error'
                      ? m.workspace.saveFailed
                      : m.workspace.saved}
                </span>
              ) : null}
            </>
          ),
          expanded,
          onToggleExpanded: canExpandPreview ? () => setExpanded((value) => !value) : undefined,
          onClose: handleClose,
          edit: isMd ? {
            active: state.markdownEditMode,
            onToggle: () => state.setMarkdownEditMode((value) => !value),
          } : isHtml ? {
            active: state.htmlCodeMode,
            onToggle: () => state.setHtmlCodeMode((value) => !value),
          } : undefined,
          wordWrap: isMd && state.markdownEditMode ? {
            active: markdownWordWrap,
            onToggle: () => setMarkdownWordWrap((value) => !value),
          } : undefined,
          share: { onClick: handleShare, loading, disabled: !state.fileResourceId || state.loading || Boolean(state.loadError) },
          openWithSystemApp: state.canOpenWithSystemApp ? { onClick: () => void handleOpenWithSystemApp() } : undefined,
          chooseApp: state.canChooseOpenWithApp ? { onClick: () => void handleChooseOpenWithApp() } : undefined,
          recommendedApps: state.recommendedOpenWithApps,
          recentApps: state.recentOpenWithApps,
          onOpenWithApp: (path) => void handleOpenWithRecentApp(path),
          onRevealInFolder: state.canRevealInFolder ? () => void handleRevealInFolder() : undefined,
          copyPath: { copied: pathCopied, onClick: () => void handleCopyPath() },
        }}
        chat={{ createFile: state.createAttachmentFile, projectId, sessionKey, agentId, disabled: state.saveStatus === 'saving' }}
        language={language}
        resolvedTheme={resolvedTheme}
        descriptor={state.descriptor}
        loading={state.loading}
        loadError={state.loadError}
        textContent={state.textContent}
        binaryBuffer={state.binaryBuffer}
        fileResourceId={state.fileResourceId}
        mtimeMs={state.mtimeMs}
        targetLine={targetLine}
        extractedText={state.extractedText}
        extractedTextTruncated={state.extractedTextTruncated}
        workspaceEditing={{
          markdownEditMode: state.markdownEditMode,
          onSaveMarkdown: state.onSaveMarkdown,
          markdownWordWrap,
          onToggleMarkdownWordWrap: () => setMarkdownWordWrap((value) => !value),
          htmlCodeMode: state.htmlCodeMode,
          onHtmlChange: state.onHtmlChange,
          isDark: resolvedTheme === 'dark',
        }}
        actions={previewActions}
      />
    </div>
  );

  return (
    <>
    {expanded ? createPortal(previewPanel, document.body) : previewPanel}
    <ShareLinkDialog
      open={dialogOpen}
      onOpenChange={handleOpenChange}
      loading={loading}
      error={error}
      result={result}
      pendingParams={pendingParams}
      onConfirm={(options) => void confirmShareLink(options)}
    />
    </>
  );
}
