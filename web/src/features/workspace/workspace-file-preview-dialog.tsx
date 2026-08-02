import {
  Check,
  Copy,
  Download,
  ExternalLink,
  Eye,
  FolderOpen,
  Link2,
  Loader2,
  Maximize2,
  MessageSquarePlus,
  Minimize2,
  MoreHorizontal,
  Pencil,
  WrapText,
  X,
} from 'lucide-react';
import { useCallback, useEffect, useState, type ReactNode } from 'react';
import { createPortal } from 'react-dom';
import { useNavigate } from 'react-router-dom';

import { APP_CHROME_NO_DRAG_CLASS } from '@/components/shell/app-chrome';
import { showComposerNotification } from '@/features/chat/composer/composer-notifications';
import { createComposerAttachmentHandoff } from '@/features/chat/composer/composer-attachment-handoff';
import { formatFileSize } from '@/features/chat/attachments/attachment-utils';
import { MAX_WEBCHAT_ATTACHMENT_FILE_BYTES } from '@/features/chat/constants';
import {
  getPreviewFileExtension,
  getPreviewFileName,
  PreviewRuntimeToolbar,
  PreviewRuntimeView,
  usePreviewRuntimeController,
  useWorkspacePreviewState,
} from '@/features/preview-runtime';
import { ShareLinkDialog } from '@/features/shares/share-link-dialog';
import { useShareLink } from '@/features/shares/use-share-link';
import { getSessionDetail } from '@/features/sessions/session-api';
import { cn } from '@/lib/cn';
import { copyTextToClipboard } from '@/lib/copy-to-clipboard';
import { isElectron } from '@/lib/electron-env';
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
  /** Project workspace root. Takes priority over chat session / agent workspace. */
  projectId?: string;
  /** Per-chat session workspace (takes priority over `agentId`). */
  sessionKey?: string;
  /** Chat agent workspace; omit to use gateway default agent root. */
  agentId?: string;
}

function PreviewMenuItem({
  icon,
  label,
  disabled,
  onClick,
}: {
  icon: ReactNode;
  label: string;
  disabled?: boolean;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      role="menuitem"
      className="flex h-9 w-full min-w-0 items-center gap-2.5 rounded-md px-2.5 text-left text-sm text-fg hover:bg-surface-hover focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent disabled:cursor-not-allowed disabled:opacity-40"
      disabled={disabled}
      onClick={onClick}
    >
      <span className="flex size-4 shrink-0 items-center justify-center text-fg-muted">{icon}</span>
      <span className="min-w-0 flex-1 truncate">{label}</span>
    </button>
  );
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
  const navigate = useNavigate();
  const resolvedTheme = useThemeStore((s) => s.resolved);

  const state = useWorkspacePreviewState({ filePath, projectId, sessionKey, agentId });
  const previewController = usePreviewRuntimeController(state.descriptor);
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
  const [moreMenuOpen, setMoreMenuOpen] = useState(false);
  const [markdownWordWrap, setMarkdownWordWrap] = useState(false);
  const [expanded, setExpanded] = useState(false);
  const [attachmentHandoffLoading, setAttachmentHandoffLoading] = useState(false);

  const ext = filePath ? getPreviewFileExtension(filePath) : '';
  const name = filePath ? getPreviewFileName(filePath) : '';
  const isMd = ext === '.md';
  const isHtml = ext === '.html' || ext === '.htm';
  const desktop = isElectron();
  const hasPreviewControls = previewController.plugin.capabilities.some((capability) =>
    ['zoom', 'search', 'rotate', 'pageNavigation'].includes(capability),
  );

  useEffect(() => {
    if (!expanded) return;
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key !== 'Escape') return;
      event.preventDefault();
      event.stopPropagation();
      setExpanded(false);
    };
    window.addEventListener('keydown', handleKeyDown, true);
    return () => {
      document.body.style.overflow = previousOverflow;
      window.removeEventListener('keydown', handleKeyDown, true);
    };
  }, [expanded]);

  useEffect(() => {
    if (!moreMenuOpen) return;
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key !== 'Escape') return;
      event.preventDefault();
      setMoreMenuOpen(false);
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [moreMenuOpen]);

  const handleCopyPath = useCallback(async () => {
    if (!filePath) return;
    const pathToCopy = desktop && state.hostAbsolutePath ? state.hostAbsolutePath : filePath;
    const ok = await copyTextToClipboard(pathToCopy);
    if (ok) {
      setPathCopied(true);
      showComposerNotification('success', m.workspace.pathCopied, undefined, { duration: 2500 });
      window.setTimeout(() => setPathCopied(false), 2000);
      return;
    }
    showComposerNotification('warning', m.clipboard.copyFailed, undefined, { duration: 4000 });
  }, [desktop, filePath, m.clipboard.copyFailed, m.workspace.pathCopied, state.hostAbsolutePath]);

  const handleShare = useCallback(() => {
    if (!filePath || projectId) return;
    const scope =
      sessionKey != null
        ? { sessionKey }
        : agentId?.trim()
          ? { agentId: agentId.trim() }
          : {};
    void createShareLink({ path: filePath, ...scope });
  }, [agentId, createShareLink, filePath, projectId, sessionKey]);

  const handleClose = useCallback(() => {
    setExpanded(false);
    onClose();
  }, [onClose]);

  const handleEditInNewChat = useCallback(async () => {
    if (!filePath || attachmentHandoffLoading) return;
    setAttachmentHandoffLoading(true);
    try {
      const [file, sourceSession] = await Promise.all([
        state.createAttachmentFile(),
        sessionKey ? getSessionDetail(sessionKey).catch(() => null) : Promise.resolve(null),
      ]);
      if (file.size > MAX_WEBCHAT_ATTACHMENT_FILE_BYTES) {
        showComposerNotification('warning', m.chat.attachmentFileTooLarge, {
          name: file.name,
          maxSize: formatFileSize(MAX_WEBCHAT_ATTACHMENT_FILE_BYTES),
        });
        return;
      }
      const handoffId = createComposerAttachmentHandoff(file);
      const params = new URLSearchParams({ attachmentHandoff: handoffId });
      const targetProjectId = projectId?.trim() || sourceSession?.projectId?.trim();
      const targetAgentId = agentId?.trim() || sourceSession?.routing?.agentId?.trim();
      if (targetProjectId) params.set('projectId', targetProjectId);
      navigate({ pathname: '/chat/new', search: `?${params.toString()}` }, {
        state: { forceNewChat: true, agentId: targetAgentId || undefined },
      });
      handleClose();
    } catch {
      showComposerNotification('error', m.workspace.editInNewChatFailed);
    } finally {
      setAttachmentHandoffLoading(false);
    }
  }, [agentId, attachmentHandoffLoading, filePath, handleClose, m.chat.attachmentFileTooLarge, m.workspace.editInNewChatFailed, navigate, projectId, sessionKey, state]);

  const canExpandPreview = Boolean(filePath && !state.loading && !state.loadError);
  const previewActions = {
    onDownload: () => void state.onDownload(),
    canDownload: state.canDownload,
    onOpenWithSystemApp: () => void state.onOpenWithSystemApp(),
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
      <div
        className={cn(
          'shrink-0 border-b border-edge px-3 py-2 dark:border-edge sm:px-4',
          APP_CHROME_NO_DRAG_CLASS,
        )}
      >
        <div className="flex min-w-0 items-start gap-2">
          <div className="min-w-0 flex-1 py-0.5">
            <h2
              className="truncate text-base font-semibold leading-tight tracking-tight text-fg"
              title={name}
            >
              {name}
            </h2>
            <div className="mt-0.5 flex min-w-0 items-center gap-2 text-xs leading-tight text-fg-muted">
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
              {state.loading ? <Loader2 className="size-3.5 shrink-0 animate-spin" aria-hidden /> : null}
              {(isMd || (isHtml && state.htmlCodeMode)) && state.saveStatus !== 'idle' ? (
                <span className={cn('shrink-0', state.saveStatus === 'error' && 'text-red-600 dark:text-red-400')}>
                  {state.saveStatus === 'saving'
                    ? m.workspace.saving
                    : state.saveStatus === 'error'
                      ? m.workspace.saveFailed
                      : m.workspace.saved}
                </span>
              ) : null}
            </div>
          </div>
          <div className="flex shrink-0 items-center gap-1">
          {isMd ? (
            <button
              type="button"
              className={cn(
                'inline-flex size-9 shrink-0 items-center justify-center rounded-md text-fg-muted transition-colors hover:bg-surface-hover hover:text-fg',
                state.markdownEditMode && 'bg-surface-active text-fg',
                interaction.focusRingPanel,
              )}
              title={state.markdownEditMode ? m.workspace.preview : m.workspace.edit}
              aria-label={state.markdownEditMode ? m.workspace.preview : m.workspace.edit}
              aria-pressed={state.markdownEditMode}
              onClick={() => state.setMarkdownEditMode((v) => !v)}
            >
              {state.markdownEditMode ? <Eye className="size-4" /> : <Pencil className="size-4" />}
            </button>
          ) : isHtml ? (
            <button
              type="button"
              className={cn(
                'inline-flex size-9 shrink-0 items-center justify-center rounded-md text-fg-muted transition-colors hover:bg-surface-hover hover:text-fg',
                state.htmlCodeMode && 'bg-surface-active text-fg',
                interaction.focusRingPanel,
              )}
              title={state.htmlCodeMode ? m.workspace.preview : m.workspace.edit}
              aria-label={state.htmlCodeMode ? m.workspace.preview : m.workspace.edit}
              aria-pressed={state.htmlCodeMode}
              onClick={() => state.setHtmlCodeMode((v) => !v)}
            >
              {state.htmlCodeMode ? <Eye className="size-4" /> : <Pencil className="size-4" />}
            </button>
          ) : null}
          {isMd && state.markdownEditMode ? (
            <button
              type="button"
              className={cn(
                'inline-flex size-9 shrink-0 items-center justify-center rounded-md text-fg-muted transition-colors hover:bg-surface-hover hover:text-fg',
                markdownWordWrap && 'bg-surface-hover text-fg',
                interaction.focusRingPanel,
              )}
              title={`${m.workspace.wordWrap} (Option+Z)`}
              aria-label={m.workspace.wordWrap}
              aria-pressed={markdownWordWrap}
              onClick={() => setMarkdownWordWrap((value) => !value)}
            >
              <WrapText className="size-4" />
            </button>
          ) : null}
          {canExpandPreview ? (
            <button
              type="button"
              className={cn(
                'inline-flex size-9 shrink-0 items-center justify-center rounded-md text-fg-muted transition-colors hover:bg-surface-hover hover:text-fg',
                expanded && 'bg-surface-active text-fg',
                interaction.focusRingPanel,
              )}
              title={expanded ? m.workspace.collapsePreview : m.workspace.expandPreview}
              aria-label={expanded ? m.workspace.collapsePreview : m.workspace.expandPreview}
              aria-pressed={expanded}
              onClick={() => setExpanded((value) => !value)}
            >
              {expanded ? <Minimize2 className="size-4" strokeWidth={1.75} /> : <Maximize2 className="size-4" strokeWidth={1.75} />}
            </button>
          ) : null}
          <button
            type="button"
            className={cn(
              'inline-flex size-9 shrink-0 items-center justify-center rounded-md text-fg-muted transition-colors hover:bg-surface-hover hover:text-fg',
              interaction.focusRingPanel,
              'disabled:cursor-not-allowed disabled:opacity-40',
            )}
            title={m.workspace.editInNewChat}
            aria-label={m.workspace.editInNewChat}
            disabled={
              state.loading ||
              Boolean(state.loadError) ||
              state.saveStatus === 'saving' ||
              attachmentHandoffLoading
            }
            onClick={() => void handleEditInNewChat()}
          >
            {attachmentHandoffLoading ? (
              <Loader2 className="size-4 animate-spin" aria-hidden />
            ) : (
              <MessageSquarePlus className="size-4" aria-hidden />
            )}
          </button>
          {!projectId ? (
            <button
              type="button"
              className={cn(
                'inline-flex size-9 shrink-0 items-center justify-center rounded-md text-fg-muted transition-colors hover:bg-surface-hover hover:text-fg',
                interaction.focusRingPanel,
                'disabled:cursor-not-allowed disabled:opacity-40',
              )}
              title={m.workspace.shareLink}
              aria-label={m.workspace.shareLink}
              onClick={handleShare}
              disabled={loading}
            >
              {loading ? <Loader2 className="size-4 animate-spin" /> : <Link2 className="size-4" />}
            </button>
          ) : null}
          <div className="relative shrink-0">
              {moreMenuOpen ? (
                <button
                  type="button"
                  className="fixed inset-0 z-40 cursor-default bg-transparent"
                  aria-hidden
                  tabIndex={-1}
                  onPointerDown={(e) => {
                    e.preventDefault();
                    setMoreMenuOpen(false);
                  }}
                />
              ) : null}
              <button
                type="button"
                className={cn(
                  'inline-flex size-9 shrink-0 items-center justify-center rounded-md text-fg-muted transition-colors hover:bg-surface-hover hover:text-fg',
                  interaction.focusRingPanel,
                )}
                title={m.workspace.moreActions}
                aria-label={m.workspace.moreActions}
                aria-haspopup="menu"
                aria-expanded={moreMenuOpen}
                onClick={() => setMoreMenuOpen((v) => !v)}
              >
                <MoreHorizontal className="size-4" />
              </button>
              {moreMenuOpen ? (
                <div
                  role="menu"
                  className="absolute right-0 top-full z-50 mt-1 w-60 rounded-lg border border-edge bg-surface-panel p-1 shadow-popover"
                >
                  {state.canOpenWithSystemApp ? (
                    <PreviewMenuItem
                      icon={<ExternalLink className="size-4" />}
                      label={m.workspace.openSystemApp}
                      onClick={() => {
                        setMoreMenuOpen(false);
                        void state.onOpenWithSystemApp();
                      }}
                    />
                  ) : null}
                  {state.canChooseOpenWithApp ? (
                    <PreviewMenuItem
                      icon={<MoreHorizontal className="size-4" />}
                      label={m.workspace.chooseApp}
                      onClick={() => {
                        setMoreMenuOpen(false);
                        void state.onChooseOpenWithApp();
                      }}
                    />
                  ) : null}
                  {state.recommendedOpenWithApps.length > 0 ? (
                    <div className="mt-1 border-t border-edge-subtle pt-1 dark:border-edge">
                      <p className="px-3 pb-1 pt-0.5 text-[11px] font-medium uppercase tracking-normal text-fg-subtle">
                        {m.workspace.recommendedApps}
                      </p>
                      {state.recommendedOpenWithApps.map((app) => (
                        <button
                          key={app.path}
                          type="button"
                          role="menuitem"
                          className="flex h-9 w-full min-w-0 items-center rounded-md px-2.5 text-left text-sm text-fg hover:bg-surface-hover"
                          title={app.path}
                          onClick={() => {
                            setMoreMenuOpen(false);
                            void state.onOpenWithRecentApp(app.path);
                          }}
                        >
                          <span className="block truncate">{app.name}</span>
                        </button>
                      ))}
                    </div>
                  ) : null}
                  {state.recentOpenWithApps.length > 0 ? (
                    <div className="mt-1 border-t border-edge-subtle pt-1 dark:border-edge">
                      <p className="px-3 pb-1 pt-0.5 text-[11px] font-medium uppercase tracking-normal text-fg-subtle">
                        {m.workspace.recentApps}
                      </p>
                      {state.recentOpenWithApps.map((app) => (
                        <button
                          key={app.path}
                          type="button"
                          role="menuitem"
                          className="flex h-9 w-full min-w-0 items-center rounded-md px-2.5 text-left text-sm text-fg hover:bg-surface-hover"
                          title={app.path}
                          onClick={() => {
                            setMoreMenuOpen(false);
                            void state.onOpenWithRecentApp(app.path);
                          }}
                        >
                          <span className="block truncate">{app.name}</span>
                        </button>
                      ))}
                    </div>
                  ) : null}
                  {state.canRevealInFolder ? (
                    <PreviewMenuItem
                      icon={<FolderOpen className="size-4" />}
                      label={m.workspace.revealInFolder}
                      onClick={() => {
                        setMoreMenuOpen(false);
                        void state.onRevealInFolder();
                      }}
                    />
                  ) : null}
                  <div className="my-1 border-t border-edge-subtle dark:border-edge" />
                  <PreviewMenuItem
                    icon={<Download className="size-4" />}
                    label={desktop ? m.workspace.saveCopy : m.workspace.download}
                    disabled={!state.canDownload}
                    onClick={() => {
                      setMoreMenuOpen(false);
                      void state.onDownload();
                    }}
                  />
                  <PreviewMenuItem
                    icon={pathCopied ? <Check className="size-4 text-emerald-500" /> : <Copy className="size-4" />}
                    label={pathCopied ? m.workspace.pathCopied : desktop ? m.workspace.copyFilePath : m.workspace.copyWorkspacePath}
                    onClick={() => {
                      setMoreMenuOpen(false);
                      void handleCopyPath();
                    }}
                  />
                </div>
              ) : null}
            </div>
          <div className="mx-0.5 h-5 w-px bg-edge-subtle" aria-hidden />
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
        {hasPreviewControls ? (
          <div className="mt-2 overflow-x-auto pb-0.5">
            <PreviewRuntimeToolbar controller={previewController} actions={previewActions} showDownload={false} />
          </div>
        ) : null}
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
          markdownWordWrap,
          onToggleMarkdownWordWrap: () => setMarkdownWordWrap((value) => !value),
          htmlCodeMode: state.htmlCodeMode,
          onHtmlChange: state.onHtmlChange,
          isDark: resolvedTheme === 'dark',
        }}
        actions={previewActions}
        controller={previewController}
        renderToolbar={() => null}
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
