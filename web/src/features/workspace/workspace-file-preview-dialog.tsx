import {
  Check,
  Copy,
  ExternalLink,
  Eye,
  FolderOpen,
  Link2,
  Loader2,
  Maximize2,
  Minimize2,
  MoreHorizontal,
  Pencil,
  X,
} from 'lucide-react';
import { useCallback, useState } from 'react';

import { APP_CHROME_NO_DRAG_CLASS } from '@/components/shell/app-chrome';
import { showComposerNotification } from '@/features/chat/composer/composer-notifications';
import {
  getPreviewFileExtension,
  getPreviewFileName,
  PreviewRuntimeToolbar,
  PreviewRuntimeView,
  usePreviewRuntimeController,
  useWorkspacePreviewState,
} from '@/features/preview-runtime';
import { useFilePreviewFullscreen } from '@/features/file-preview/use-file-preview-fullscreen';
import { ShareLinkDialog } from '@/features/shares/share-link-dialog';
import { useShareLink } from '@/features/shares/use-share-link';
import { cn } from '@/lib/cn';
import { copyTextToClipboard } from '@/lib/copy-to-clipboard';
import { interaction } from '@/lib/interaction';
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
  /** Per-chat session workspace (takes priority over `agentId`). */
  sessionKey?: string;
  /** Chat agent workspace; omit to use gateway default agent root. */
  agentId?: string;
}

export function WorkspaceFilePreviewPanel({
  filePath,
  onClose,
  targetLine,
  sessionKey,
  agentId,
}: WorkspaceFilePreviewPanelProps) {
  const language = useLocaleStore((s) => s.language);
  const m = messages(language);
  const resolvedTheme = useThemeStore((s) => s.resolved);

  const state = useWorkspacePreviewState({ filePath, sessionKey, agentId });
  const previewController = usePreviewRuntimeController(state.descriptor);
  const { rootRef, active, enter, exit } = useFilePreviewFullscreen();
  const { dialogOpen, loading, result, error, createShareLink, handleOpenChange } = useShareLink();
  const [pathCopied, setPathCopied] = useState(false);
  const [openWithMenuOpen, setOpenWithMenuOpen] = useState(false);

  const ext = filePath ? getPreviewFileExtension(filePath) : '';
  const name = filePath ? getPreviewFileName(filePath) : '';
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
  const previewActions = {
    onDownload: () => void state.onDownload(),
    canDownload: state.canDownload,
    onOpenWithSystemApp: () => void state.onOpenWithSystemApp(),
    canOpenWithSystemApp: state.canOpenWithSystemApp,
    onChooseOpenWithApp: () => void state.onChooseOpenWithApp(),
    canChooseOpenWithApp: state.canChooseOpenWithApp,
  };

  const handleClose = useCallback(() => {
    void exit();
    onClose();
  }, [exit, onClose]);

  if (!filePath) {
    return null;
  }

  return (
    <>
    <div ref={rootRef} className="flex h-full min-h-0 flex-col bg-surface-panel">
      <div
        className={cn(
          'flex shrink-0 items-start gap-2 border-b border-edge px-4 py-2 dark:border-edge',
          APP_CHROME_NO_DRAG_CLASS,
        )}
      >
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
              {targetLine ? ` · Line ${targetLine}` : ''}
            </p>
          ) : null}
        </div>
        <div className="flex shrink-0 items-center gap-2 pt-0.5">
          {state.loading ? (
            <Loader2 className="size-4 animate-spin text-fg-muted" aria-hidden />
          ) : null}
          {(isMd || (isHtml && state.htmlCodeMode)) && state.saveStatus !== 'idle' ? (
            <span className="shrink-0 text-xs leading-tight text-fg-muted">
              {state.saveStatus === 'saving' ? m.workspace.saving : m.workspace.saved}
            </span>
          ) : null}
          <PreviewRuntimeToolbar controller={previewController} actions={previewActions} />
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
          {state.canOpenWithSystemApp ? (
            <button
              type="button"
              className={cn(
                'inline-flex size-9 shrink-0 items-center justify-center rounded-md text-fg-muted transition-colors hover:bg-surface-hover hover:text-fg',
                interaction.focusRingPanel,
              )}
              title={m.workspace.openSystemApp}
              aria-label={m.workspace.openSystemApp}
              onClick={() => void state.onOpenWithSystemApp()}
            >
              <ExternalLink className="size-4" />
            </button>
          ) : null}
          {state.canChooseOpenWithApp ||
          state.recommendedOpenWithApps.length > 0 ||
          state.recentOpenWithApps.length > 0 ? (
            <div className="relative shrink-0">
              {openWithMenuOpen ? (
                <button
                  type="button"
                  className="fixed inset-0 z-40 cursor-default bg-transparent"
                  aria-hidden
                  tabIndex={-1}
                  onPointerDown={(e) => {
                    e.preventDefault();
                    setOpenWithMenuOpen(false);
                  }}
                />
              ) : null}
              <button
                type="button"
                className={cn(
                  'inline-flex size-9 shrink-0 items-center justify-center rounded-md text-fg-muted transition-colors hover:bg-surface-hover hover:text-fg',
                  interaction.focusRingPanel,
                )}
                title={m.workspace.openWith}
                aria-label={m.workspace.openWith}
                aria-haspopup="menu"
                aria-expanded={openWithMenuOpen}
                onClick={() => setOpenWithMenuOpen((v) => !v)}
              >
                <MoreHorizontal className="size-4" />
              </button>
              {openWithMenuOpen ? (
                <div
                  role="menu"
                  className="absolute right-0 top-full z-50 mt-1 min-w-[13rem] rounded-md border border-edge bg-surface-panel py-1 shadow-popover"
                >
                  {state.canChooseOpenWithApp ? (
                    <button
                      type="button"
                      role="menuitem"
                      className="block w-full px-3 py-1.5 text-left text-sm text-fg hover:bg-surface-hover"
                      onClick={() => {
                        setOpenWithMenuOpen(false);
                        void state.onChooseOpenWithApp();
                      }}
                    >
                      {m.workspace.chooseApp}
                    </button>
                  ) : null}
                  {state.recommendedOpenWithApps.length > 0 ? (
                    <div className="border-t border-edge-subtle py-1 dark:border-edge">
                      <p className="px-3 pb-1 pt-0.5 text-[11px] font-medium uppercase tracking-normal text-fg-subtle">
                        {m.workspace.recommendedApps}
                      </p>
                      {state.recommendedOpenWithApps.map((app) => (
                        <button
                          key={app.path}
                          type="button"
                          role="menuitem"
                          className="block w-full min-w-0 px-3 py-1.5 text-left text-sm text-fg hover:bg-surface-hover"
                          title={app.path}
                          onClick={() => {
                            setOpenWithMenuOpen(false);
                            void state.onOpenWithRecentApp(app.path);
                          }}
                        >
                          <span className="block truncate">{app.name}</span>
                        </button>
                      ))}
                    </div>
                  ) : null}
                  {state.recentOpenWithApps.length > 0 ? (
                    <div className="border-t border-edge-subtle py-1 dark:border-edge">
                      <p className="px-3 pb-1 pt-0.5 text-[11px] font-medium uppercase tracking-normal text-fg-subtle">
                        {m.workspace.recentApps}
                      </p>
                      {state.recentOpenWithApps.map((app) => (
                        <button
                          key={app.path}
                          type="button"
                          role="menuitem"
                          className="block w-full min-w-0 px-3 py-1.5 text-left text-sm text-fg hover:bg-surface-hover"
                          title={app.path}
                          onClick={() => {
                            setOpenWithMenuOpen(false);
                            void state.onOpenWithRecentApp(app.path);
                          }}
                        >
                          <span className="block truncate">{app.name}</span>
                        </button>
                      ))}
                    </div>
                  ) : null}
                </div>
              ) : null}
            </div>
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
            className="inline-flex size-9 shrink-0 items-center justify-center rounded-md text-fg-muted transition-colors hover:bg-surface-hover hover:text-fg"
            title={m.workspace.close}
            aria-label={m.workspace.close}
            onClick={handleClose}
          >
            <X className="size-4" strokeWidth={1.75} />
          </button>
        </div>
      </div>
      <PreviewRuntimeView
        language={language}
        resolvedTheme={resolvedTheme}
        descriptor={state.descriptor}
        loading={state.loading}
        loadError={state.loadError}
        textContent={state.textContent}
        binaryBuffer={state.binaryBuffer}
        hostAbsolutePath={state.hostAbsolutePath}
        mtimeMs={state.mtimeMs}
        targetLine={targetLine}
        extractedText={state.extractedText}
        extractedTextTruncated={state.extractedTextTruncated}
        workspaceEditing={{
          markdownEditMode: state.markdownEditMode,
          onSaveMarkdown: state.onSaveMarkdown,
          htmlCodeMode: state.htmlCodeMode,
          onHtmlChange: state.onHtmlChange,
          isDark: resolvedTheme === 'dark',
        }}
        actions={previewActions}
        controller={previewController}
        renderToolbar={() => null}
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
