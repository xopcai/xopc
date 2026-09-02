import * as Dialog from '@radix-ui/react-dialog';
import { ExternalLink, Loader2, Maximize2, Minimize2, X } from 'lucide-react';
import { useState } from 'react';

import { APP_CHROME_NO_DRAG_CLASS } from '@/components/shell/app-chrome';
import { showComposerNotification } from '@/features/chat/composer/composer-notifications';
import type { MessageAttachment } from '@/features/chat/messages/messages.types';
import { getAttachmentBinaryPayload } from '@/features/chat/attachments/attachment-utils-core';
import {
  PreviewRuntimeToolbar,
  PreviewRuntimeView,
  useAttachmentPreviewResolved,
  usePreviewRuntimeController,
  type PreviewFileType,
} from '@/features/preview-runtime';
import { useFilePreviewFullscreen } from '@/features/file-preview/use-file-preview-fullscreen';
import { cn } from '@/lib/cn';
import { isElectron } from '@/lib/electron-env';
import { interaction } from '@/lib/interaction';
import { messages } from '@/i18n/messages';
import { useLocaleStore } from '@/stores/locale-store';

function fileTypeLabel(ft: PreviewFileType, labels: ReturnType<typeof messages>['chat']): string {
  switch (ft) {
    case 'pdf':
      return labels.attachmentPreviewPdf;
    case 'docx':
      return labels.attachmentPreviewDocument;
    case 'pptx':
      return labels.attachmentPreviewPresentation;
    case 'spreadsheet':
      return labels.attachmentPreviewSpreadsheet;
    default:
      return '';
  }
}

export function AttachmentPreviewDialog({
  open,
  attachment,
  authToken,
  sessionKey,
  layerClassName = 'z-[81]',
  onClose,
}: {
  open: boolean;
  attachment: MessageAttachment | null;
  authToken?: string;
  sessionKey?: string | null;
  layerClassName?: string;
  onClose: () => void;
}) {
  const language = useLocaleStore((s) => s.language);
  const labels = messages(language).chat;
  const resolved = useAttachmentPreviewResolved({ open, attachment, authToken, sessionKey, language });
  const previewController = usePreviewRuntimeController(resolved.descriptor);
  const { rootRef, active, enter, exit } = useFilePreviewFullscreen();
  const [openingLocalApp, setOpeningLocalApp] = useState(false);

  const { preview, fileType, hasExtractedText, showExtractedText } = resolved;
  const showToggle =
    fileType !== 'image' && fileType !== 'text' && fileType !== 'pptx' && hasExtractedText;

  const canPreviewFullscreen = Boolean(preview && !resolved.loading && !resolved.loadError);

  const handleClose = () => {
    void exit();
    onClose();
  };

  const handleDownload = () => {
    if (!preview) return;
    const mime = preview.mimeType || 'application/octet-stream';
    let blob: Blob | null = null;
    if (resolved.binaryBuffer) {
      blob = new Blob([resolved.binaryBuffer], { type: mime });
    } else {
      const payload = getAttachmentBinaryPayload(preview);
      if (!payload) return;
      try {
        const binary = atob(payload.replace(/\s/g, ''));
        const bytes = new Uint8Array(binary.length);
        for (let i = 0; i < binary.length; i++) {
          bytes[i] = binary.charCodeAt(i);
        }
        blob = new Blob([bytes], { type: mime });
      } catch {
        return;
      }
    }
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = preview.name ?? 'download';
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
  };

  const canDownload = Boolean(resolved.binaryBuffer || getAttachmentBinaryPayload(preview ?? {}));
  const canOpenWithLocalApp =
    isElectron()
    && fileType === 'spreadsheet'
    && /\.xlsx?$/i.test(resolved.fileName)
    && Boolean(resolved.binaryBuffer)
    && Boolean(window.electronAPI?.shell?.openTemporaryFile);

  const handleOpenWithLocalApp = async () => {
    const buffer = resolved.binaryBuffer;
    const openTemporaryFile = window.electronAPI?.shell?.openTemporaryFile;
    if (!buffer || !openTemporaryFile || openingLocalApp) return;
    setOpeningLocalApp(true);
    try {
      const result = await openTemporaryFile({
        fileName: resolved.fileName,
        data: new Uint8Array(buffer),
      });
      if (!result.ok) {
        showComposerNotification('warning', labels.attachmentPreviewOpenLocalFailed);
      }
    } catch {
      showComposerNotification('warning', labels.attachmentPreviewOpenLocalFailed);
    } finally {
      setOpeningLocalApp(false);
    }
  };

  const previewActions = {
    onDownload: handleDownload,
    canDownload,
  };

  const sideStripClass = cn(
    'min-h-0 min-w-0 flex-1 cursor-pointer border-0 p-0',
    'bg-surface-base transition-colors',
    'hover:bg-surface-hover/90 dark:bg-black/60 dark:hover:bg-black/70',
    interaction.focusRingBase,
  );

  return (
    <Dialog.Root open={open} onOpenChange={(o) => !o && handleClose()}>
      <Dialog.Portal>
        <Dialog.Content
          className={cn(
            'xopc-dialog-content-fullscreen fixed inset-0 flex h-[100dvh] w-full flex-row overflow-hidden',
            layerClassName,
            'border-0 bg-transparent p-0 shadow-none outline-none',
          )}
        >
          <button
            type="button"
            className={sideStripClass}
            onClick={handleClose}
            aria-label={labels.attachmentPreviewClose}
          />

          <div
            ref={rootRef}
            className={cn(
              'flex h-full min-h-0 w-[min(100%,var(--max-width-app-main))] shrink-0 flex-col overflow-hidden',
              'bg-surface-panel sm:border-x sm:border-edge dark:sm:border-edge',
              'shadow-float dark:shadow-elevated',
            )}
          >
            <div
              className={cn(
                'flex shrink-0 items-start gap-2 border-b border-edge px-4 py-2 dark:border-edge',
                APP_CHROME_NO_DRAG_CLASS,
              )}
            >
                <Dialog.Title className="min-w-0 flex-1 truncate text-sm font-semibold text-fg">
                  {preview?.name ?? ''}
                </Dialog.Title>
                <div className="flex shrink-0 items-center gap-1">
                  {showToggle ? (
                    <div
                      className="mr-2 flex rounded-lg border border-edge p-0.5 dark:border-edge"
                      role="group"
                      aria-label={labels.attachmentPreviewText}
                    >
                      <button
                        type="button"
                        className={`rounded-md px-2.5 py-1 text-xs font-medium ${
                          !showExtractedText ? 'bg-surface-hover text-fg' : 'text-fg-muted hover:text-fg'
                        }`}
                        onClick={() => {
                          resolved.setShowExtractedText(false);
                          resolved.clearLoadError();
                        }}
                      >
                        {fileTypeLabel(fileType, labels)}
                      </button>
                      <button
                        type="button"
                        className={`rounded-md px-2.5 py-1 text-xs font-medium ${
                          showExtractedText ? 'bg-surface-hover text-fg' : 'text-fg-muted hover:text-fg'
                        }`}
                        onClick={() => {
                          resolved.setShowExtractedText(true);
                          resolved.clearLoadError();
                        }}
                      >
                        {labels.attachmentPreviewText}
                      </button>
                    </div>
                  ) : null}
                  {canOpenWithLocalApp ? (
                    <button
                      type="button"
                      className="inline-flex h-9 shrink-0 items-center gap-1.5 rounded-md px-2 text-xs font-medium text-fg-muted hover:bg-surface-hover hover:text-fg disabled:opacity-50"
                      title={labels.attachmentPreviewOpenLocal}
                      aria-label={labels.attachmentPreviewOpenLocal}
                      disabled={openingLocalApp}
                      onClick={() => void handleOpenWithLocalApp()}
                    >
                      {openingLocalApp ? (
                        <Loader2 className="size-4 animate-spin" aria-hidden />
                      ) : (
                        <ExternalLink className="size-4" aria-hidden />
                      )}
                      <span className="hidden sm:inline">{labels.attachmentPreviewOpenLocal}</span>
                    </button>
                  ) : null}
                  {preview ? <PreviewRuntimeToolbar controller={previewController} actions={previewActions} /> : null}
                  {canPreviewFullscreen ? (
                    <button
                      type="button"
                      className="rounded-md p-2 text-fg-muted hover:bg-surface-hover hover:text-fg"
                      title={active ? labels.attachmentPreviewExitFullscreen : labels.attachmentPreviewFullscreen}
                      aria-label={active ? labels.attachmentPreviewExitFullscreen : labels.attachmentPreviewFullscreen}
                      onClick={() => void (active ? exit() : enter())}
                    >
                      {active ? <Minimize2 className="size-4" /> : <Maximize2 className="size-4" />}
                    </button>
                  ) : null}
                  <Dialog.Close asChild>
                    <button
                      type="button"
                      className="rounded-md p-2 text-fg-muted hover:bg-surface-hover hover:text-fg"
                      title={labels.attachmentPreviewClose}
                      aria-label={labels.attachmentPreviewClose}
                    >
                      <X className="size-4" />
                    </button>
                  </Dialog.Close>
                </div>
            </div>

            <div className="flex min-h-0 flex-1 flex-col overflow-hidden px-4 pb-4 pt-2 sm:px-8">
              {preview ? (
                <PreviewRuntimeView
                  language={language}
                  descriptor={resolved.descriptor}
                  loading={resolved.loading}
                  loadError={resolved.loadError}
                  textContent={resolved.textContent}
                  binaryBuffer={resolved.binaryBuffer}
                  showExtractedText={resolved.showExtractedText}
                  extractedText={resolved.extractedText}
                  extractedTextTruncated={resolved.extractedTextTruncated}
                  actions={{
                    onDownload: handleDownload,
                    canDownload,
                  }}
                  controller={previewController}
                  renderToolbar={() => null}
                />
              ) : null}
            </div>
          </div>

          <button
            type="button"
            className={sideStripClass}
            onClick={handleClose}
            aria-label={labels.attachmentPreviewClose}
          />
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  );
}
