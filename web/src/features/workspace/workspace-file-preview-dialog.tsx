import { useCallback, useEffect, useState } from 'react';

import { useFilePreviewExpanded } from '@/features/file-preview/use-file-preview-expanded';
import { readPreviewView, savePreviewView } from '@/features/preview-runtime/preview-view-state';
import { registerFileCloseGuard } from '@/features/right-workspace/file-close-guards';
import { useRightWorkspaceStore } from '@/stores/right-workspace-store';
import { FilePreview } from '@/features/file-preview/file-preview';
import { FilePreviewSurface } from '@/features/file-preview/file-preview-surface';
import { Skeleton } from '@/components/ui/skeleton';
import { showComposerNotification } from '@/features/chat/composer/composer-notifications';
import {
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
  tabId?: string;
  active?: boolean;
  filePath: string | null;
  onClose: () => void;
  targetLine?: number | null;
  resultRevision?: number;
  /** Project workspace root. Takes priority over chat session / agent workspace. */
  projectId?: string;
  /** Per-chat session workspace (takes priority over `agentId`). */
  conversationId?: string;
  /** Chat agent workspace; omit to use gateway default agent root. */
  agentId?: string;
}

export function WorkspaceFilePreviewPanel({
  filePath,
  tabId,
  active = true,
  onClose,
  targetLine,
  resultRevision,
  projectId,
  conversationId,
  agentId,
}: WorkspaceFilePreviewPanelProps) {
  const language = useLocaleStore((s) => s.language);
  const m = messages(language);
  const resolvedTheme = useThemeStore((s) => s.resolved);

  const state = useWorkspacePreviewState({ filePath, projectId, conversationId, agentId, initialEditMode: tabId ? readPreviewView(tabId).sourceEditMode : false });
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

  useEffect(() => {
    if (tabId) savePreviewView(tabId, { sourceEditMode: state.sourceEditMode });
  }, [state.sourceEditMode, tabId]);
  useEffect(() => {
    if (!tabId) return;
    return registerFileCloseGuard(tabId, state.flushSource);
  }, [state.flushSource, tabId]);
  useEffect(() => {
    if (tabId && state.fileResourceId) useRightWorkspaceStore.getState().resolveFileIdentity(tabId, state.fileResourceId);
  }, [state.fileResourceId, tabId]);
  useEffect(() => {
    if (tabId) useRightWorkspaceStore.getState().setFileStatus(tabId, state.saveStatus === 'error' ? 'error' : state.dirty ? 'dirty' : null);
  }, [state.dirty, state.saveStatus, tabId]);
  useEffect(() => {
    const refresh = () => { if (document.visibilityState !== 'hidden') void state.checkForUpdates(); };
    window.addEventListener('focus', refresh);
    window.addEventListener('workspace-refresh-files', refresh);
    window.addEventListener('agent-run-ended', refresh);
    document.addEventListener('visibilitychange', refresh);
    return () => { window.removeEventListener('focus', refresh); window.removeEventListener('workspace-refresh-files', refresh); window.removeEventListener('agent-run-ended', refresh); document.removeEventListener('visibilitychange', refresh); };
  }, [state.checkForUpdates]);

  const name = filePath ? getPreviewFileName(filePath) : '';
  const isEditableText = ['text', 'markdown', 'code', 'html'].includes(state.descriptor.type);

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

  if (!filePath || !active) {
    return null;
  }

  const previewPanel = (
    <FilePreviewSurface expanded={expanded}>
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
              {state.externalChange ? <span role="status" className="text-fg-muted">{language === 'zh' ? '文件已更新，请先处理当前编辑' : 'File changed; review your current edits'}</span> : null}
              {resultRevision ? (
                <span className="shrink-0" data-result-revision>
                  {language === 'zh' ? '成果版本' : 'Result version'} {resultRevision}
                </span>
              ) : null}
              {state.loading ? <Skeleton className="h-3.5 w-32" /> : null}
              {isEditableText && state.sourceEditMode && state.saveStatus !== 'idle' ? (
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
          onRefresh: state.refresh,
          onRetrySave: state.saveStatus === 'error' ? () => void state.flushSource() : undefined,
          onToggleExpanded: canExpandPreview ? () => setExpanded((value) => !value) : undefined,
          hideClose: Boolean(tabId),
          onClose: handleClose,
          edit: isEditableText ? {
            active: state.sourceEditMode,
            onToggle: () => state.setSourceEditMode((value) => !value),
          } : undefined,
          wordWrap: isEditableText && state.sourceEditMode ? {
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
        chat={{ createFile: state.createAttachmentFile, projectId, conversationId, agentId, disabled: state.saveStatus === 'saving' }}
        language={language}
        resolvedTheme={resolvedTheme}
        descriptor={tabId ? { ...state.descriptor, id: tabId } : state.descriptor}
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
          sourceEditMode: state.sourceEditMode,
          onSourceChange: (value) => { if (tabId) useRightWorkspaceStore.getState().keepFileOpen(tabId); state.onSourceChange(value); },
          sourceWordWrap: markdownWordWrap,
          isDark: resolvedTheme === 'dark',
        }}
        actions={previewActions}
      />
    </FilePreviewSurface>
  );

  return (
    <>
    {previewPanel}
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
