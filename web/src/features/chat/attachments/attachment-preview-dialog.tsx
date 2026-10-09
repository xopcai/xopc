import { parseFileResourceArtifactUri } from '@xopcai/gateway-contract';
import * as Dialog from '@radix-ui/react-dialog';
import { useState } from 'react';
import { ChevronLeft, ChevronRight } from 'lucide-react';

import { ShareLinkDialog } from '@/features/shares/share-link-dialog';
import { useShareLink } from '@/features/shares/use-share-link';
import { FilePreview } from '@/features/file-preview/file-preview';
import { showComposerNotification } from '@/features/chat/composer/composer-notifications';
import type { MessageAttachment } from '@/features/chat/messages/messages.types';
import {
  useAttachmentPreviewResolved,
} from '@/features/preview-runtime';
import { useFilePreviewExpanded } from '@/features/file-preview/use-file-preview-expanded';
import { cn } from '@/lib/cn';
import { isElectron } from '@/lib/electron-env';
import { electronPreviewViewportClass } from '@/lib/electron-window-chrome';
import { interaction } from '@/lib/interaction';
import { messages } from '@/i18n/messages';
import { useLocaleStore } from '@/stores/locale-store';

export function AttachmentPreviewDialog({
  open,
  attachment,
  images = [],
  onAttachmentChange,
  authToken,
  conversationId,
  layerClassName = 'z-[81]',
  onClose,
}: {
  open: boolean;
  attachment: MessageAttachment | null;
  images?: MessageAttachment[];
  onAttachmentChange?: (attachment: MessageAttachment) => void;
  authToken?: string;
  conversationId?: string | null;
  layerClassName?: string;
  onClose: () => void;
}) {
  const language = useLocaleStore((s) => s.language);
  const labels = messages(language).chat;
  const resolved = useAttachmentPreviewResolved({ open, attachment, authToken, conversationId, language });
  const share = useShareLink();
  const { expanded, setExpanded } = useFilePreviewExpanded(open, share.dialogOpen);
  const [openingLocalApp, setOpeningLocalApp] = useState(false);

  const { preview, fileType, hasExtractedText } = resolved;
  const imageIndex = attachment ? images.findIndex((image) =>
    image === attachment || (image.id && image.id === attachment.id)
    || (image.uri && image.uri === attachment.uri)
    || (!image.id && !image.uri && image.name === attachment.name && Boolean(image.data) && image.data === attachment.data),
  ) : -1;
  const hasGallery = fileType === 'image' && images.length > 1 && imageIndex >= 0 && Boolean(onAttachmentChange);
  const navigateImage = (direction: 'previous' | 'next') => {
    if (!hasGallery || share.dialogOpen) return;
    const next = imageIndex + (direction === 'previous' ? -1 : 1);
    if (next >= 0 && next < images.length) onAttachmentChange?.(images[next]);
  };
  const showToggle =
    fileType !== 'image' && fileType !== 'text' && fileType !== 'pptx' && hasExtractedText;

  const fileId = preview?.uri ? parseFileResourceArtifactUri(preview.uri) : null;
  const canShare = Boolean(fileId || (preview?.uri?.startsWith('media://') && (conversationId || preview.taskId)));
  const handleShare = () => {
    if (!preview?.uri || !canShare) return;
    share.createShareLink(fileId
      ? { fileId, fileName: preview.name }
      : { uri: preview.uri, conversationId: conversationId ?? undefined, taskId: preview.taskId, fileName: preview.name });
  };

  const canExpandPreview = Boolean(preview && !resolved.loading && !resolved.loadError);

  const handleClose = () => {
    setExpanded(false);
    onClose();
  };

  const handleDownload = () => {
    if (!preview || !resolved.downloadBuffer) return;
    const blob = new Blob([resolved.downloadBuffer], { type: resolved.descriptor.mimeType });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = preview.name ?? 'download';
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
  };

  const canDownload = Boolean(resolved.downloadBuffer);
  const canOpenWithLocalApp =
    isElectron()
    && fileType === 'spreadsheet'
    && /\.xlsx?$/i.test(resolved.fileName)
    && Boolean(resolved.downloadBuffer)
    && Boolean(window.electronAPI?.shell?.openTemporaryFile);

  const handleOpenWithLocalApp = async () => {
    const buffer = resolved.downloadBuffer;
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
    <>
    <Dialog.Root open={open} onOpenChange={(o) => !o && handleClose()}>
      <Dialog.Portal>
        <Dialog.Content
          aria-describedby={undefined}
          onKeyDown={(event) => {
            if (!hasGallery || share.dialogOpen || event.altKey || event.ctrlKey || event.metaKey) return;
            const target = event.target as HTMLElement;
            if (target.closest('input, textarea, select, [contenteditable="true"]')) return;
            if (event.key === 'ArrowLeft' || event.key === 'ArrowRight') {
              event.preventDefault();
              navigateImage(event.key === 'ArrowLeft' ? 'previous' : 'next');
            }
          }}
          className={cn(
            'xopc-dialog-content-fullscreen fixed inset-0 flex h-[100dvh] w-full flex-row overflow-hidden',
            electronPreviewViewportClass(),
            layerClassName,
            'border-0 bg-transparent p-0 shadow-none outline-none',
          )}
        >
          <Dialog.Title className="sr-only">{preview?.name ?? ''}</Dialog.Title>
          <button
            type="button"
            className={sideStripClass}
            onClick={handleClose}
            aria-label={labels.attachmentPreviewClose}
          />

          <div
            className={cn(
              'flex h-full min-h-0 shrink-0 flex-col overflow-hidden',
              expanded ? 'w-full' : 'w-[min(100%,var(--max-width-app-main))]',
              'bg-surface-panel sm:border-x sm:border-edge dark:sm:border-edge',
              'shadow-float dark:shadow-elevated',
            )}
          >
            <FilePreview
              header={{
                expanded,
                onToggleExpanded: canExpandPreview ? () => setExpanded((value) => !value) : undefined,
                onClose: handleClose,
                share: canShare ? { onClick: handleShare, loading: share.loading } : undefined,
                openWithSystemApp: canOpenWithLocalApp ? {
                  onClick: () => void handleOpenWithLocalApp(),
                  loading: openingLocalApp,
                } : undefined,
                textView: showToggle ? {
                  active: resolved.showExtractedText,
                  onChange: (active) => {
                    resolved.setShowExtractedText(active);
                    resolved.clearLoadError();
                  },
                } : undefined,
              }}
              chat={resolved.downloadBuffer ? {
                conversationId,
                createFile: async () => new File([resolved.downloadBuffer!], resolved.fileName, { type: resolved.descriptor.mimeType }),
              } : undefined}
              onImageSwipe={hasGallery ? navigateImage : undefined}
              language={language}
              descriptor={resolved.descriptor}
              loading={resolved.loading}
              loadError={resolved.loadError}
              textContent={resolved.textContent}
              binaryBuffer={resolved.binaryBuffer}
              showExtractedText={resolved.showExtractedText}
              extractedText={resolved.extractedText}
              extractedTextTruncated={resolved.extractedTextTruncated}
              actions={previewActions}
            />
            {hasGallery ? (
              <div className="flex shrink-0 items-center justify-center gap-4 border-t border-edge bg-surface-panel px-3 py-2">
                <button type="button" aria-label={labels.attachmentPreviewPreviousImage}
                  disabled={imageIndex === 0} onClick={() => navigateImage('previous')}
                  className={cn('flex size-11 touch-manipulation items-center justify-center rounded-lg hover:bg-surface-hover disabled:opacity-30', interaction.focusRingBase)}>
                  <ChevronLeft size={20} aria-hidden="true" />
                </button>
                <span role="status" className="min-w-16 text-center text-sm tabular-nums text-fg-muted">{imageIndex + 1} / {images.length}</span>
                <button type="button" aria-label={labels.attachmentPreviewNextImage}
                  disabled={imageIndex === images.length - 1} onClick={() => navigateImage('next')}
                  className={cn('flex size-11 touch-manipulation items-center justify-center rounded-lg hover:bg-surface-hover disabled:opacity-30', interaction.focusRingBase)}>
                  <ChevronRight size={20} aria-hidden="true" />
                </button>
              </div>
            ) : null}
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
    <ShareLinkDialog
      open={share.dialogOpen}
      onOpenChange={share.handleOpenChange}
      loading={share.loading}
      error={share.error}
      result={share.result}
      pendingParams={share.pendingParams}
      onConfirm={(options) => void share.confirmShareLink(options)}
    />
    </>
  );
}
