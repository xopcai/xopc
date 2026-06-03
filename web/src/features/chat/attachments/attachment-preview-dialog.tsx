import * as Dialog from '@radix-ui/react-dialog';
import { Download, Maximize2, Minimize2, X } from 'lucide-react';

import { APP_CHROME_NO_DRAG_CLASS } from '@/components/shell/app-chrome';
import type { MessageAttachment } from '@/features/chat/messages/messages.types';
import {
  getAttachmentBinaryPayload,
  type AttachmentPreviewFileType,
} from '@/features/chat/attachments/attachment-utils-core';
import { FilePreviewBody, useAttachmentPreviewResolved, useFilePreviewFullscreen } from '@/features/file-preview';
import { cn } from '@/lib/cn';
import { interaction } from '@/lib/interaction';
import { messages } from '@/i18n/messages';
import { useLocaleStore } from '@/stores/locale-store';

function fileTypeLabel(ft: AttachmentPreviewFileType, labels: ReturnType<typeof messages>['chat']): string {
  switch (ft) {
    case 'pdf':
      return labels.attachmentPreviewPdf;
    case 'docx':
      return labels.attachmentPreviewDocument;
    case 'pptx':
      return labels.attachmentPreviewPresentation;
    case 'excel':
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
  onClose,
}: {
  open: boolean;
  attachment: MessageAttachment | null;
  authToken?: string;
  sessionKey?: string | null;
  onClose: () => void;
}) {
  const language = useLocaleStore((s) => s.language);
  const labels = messages(language).chat;
  const resolved = useAttachmentPreviewResolved({ open, attachment, authToken, sessionKey, language });
  const { rootRef, active, enter, exit } = useFilePreviewFullscreen();

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
    const payload = getAttachmentBinaryPayload(preview);
    if (!payload) return;
    const byteCharacters = atob(payload);
    const byteNumbers = new Array(byteCharacters.length);
    for (let i = 0; i < byteCharacters.length; i++) {
      byteNumbers[i] = byteCharacters.charCodeAt(i);
    }
    const byteArray = new Uint8Array(byteNumbers);
    const blob = new Blob([byteArray], { type: preview.mimeType || 'application/octet-stream' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = preview.name ?? 'download';
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
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
            'xopc-dialog-content-fullscreen fixed inset-0 z-[81] flex h-[100dvh] w-full flex-row overflow-hidden',
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
                'shrink-0 border-b border-edge bg-surface-panel dark:border-edge',
                APP_CHROME_NO_DRAG_CLASS,
              )}
            >
              <div className="flex w-full items-center justify-between gap-2 px-4 py-3 sm:px-8">
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
                  <button
                    type="button"
                    className="rounded-md p-2 text-fg-muted hover:bg-surface-hover hover:text-fg"
                    title={labels.attachmentPreviewDownload}
                    aria-label={labels.attachmentPreviewDownload}
                    onClick={handleDownload}
                  >
                    <Download className="size-4" />
                  </button>
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
            </div>

            <div className="flex min-h-0 flex-1 flex-col overflow-hidden px-4 pb-4 pt-2 sm:px-8">
              {preview ? (
                <FilePreviewBody
                  context="attachment"
                  language={language}
                  fileKey={resolved.fileKey}
                  fileName={resolved.fileName}
                  loading={resolved.loading}
                  loadError={resolved.loadError}
                  previewKind={resolved.previewKind}
                  textContent={resolved.textContent}
                  binaryBuffer={resolved.binaryBuffer}
                  showExtractedText={resolved.showExtractedText}
                  extractedText={resolved.extractedText}
                  extractedTextTruncated={resolved.extractedTextTruncated}
                  actions={{
                    onDownload: handleDownload,
                    canDownload: Boolean(getAttachmentBinaryPayload(preview)),
                  }}
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
