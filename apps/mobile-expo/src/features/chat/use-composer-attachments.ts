import { useCallback, useRef, useState } from 'react';

import {
  AttachmentFileError,
  formatAttachmentSize,
  pickAttachmentFromSource,
  type AttachmentPickSource,
} from './attachment-file-io';
import { MAX_CHAT_ATTACHMENTS, MAX_WEBCHAT_ATTACHMENT_FILE_BYTES } from './chat-limits';
import { composerAttachmentsToWire, type ComposerAttachment, type WireAttachment } from './composer.types';

export type ComposerAttachmentMessages = {
  maxAttachmentsReached: string;
  maxAttachmentsTruncated: string;
  attachmentFileTooLarge: string;
  attachmentLoadFailed: string;
  attachmentPermissionDenied: string;
  attachmentCameraPermissionDenied: string;
};

export function useComposerAttachments(messages: ComposerAttachmentMessages) {
  const [attachments, setAttachments] = useState<ComposerAttachment[]>([]);
  const attachmentsRef = useRef(attachments);
  attachmentsRef.current = attachments;

  const [sheetOpen, setSheetOpen] = useState(false);
  const [snack, setSnack] = useState('');

  const clearAttachments = useCallback(() => {
    setAttachments([]);
  }, []);

  const restoreAttachments = useCallback((nextAttachments: ComposerAttachment[]) => {
    setAttachments(nextAttachments);
  }, []);

  const removeAttachment = useCallback((index: number) => {
    setAttachments((prev) => prev.filter((_, i) => i !== index));
  }, []);

  const toWirePayload = useCallback((): WireAttachment[] => {
    return composerAttachmentsToWire(attachmentsRef.current);
  }, []);

  const addFromSource = useCallback(
    async (source: AttachmentPickSource): Promise<boolean> => {
      if (attachmentsRef.current.length >= MAX_CHAT_ATTACHMENTS) {
        setSnack(messages.maxAttachmentsReached.replace('{{max}}', String(MAX_CHAT_ATTACHMENTS)));
        return false;
      }
      try {
        const next = await pickAttachmentFromSource(source);
        if (!next) return false;
        let added = false;
        setAttachments((prev) => {
          if (prev.length >= MAX_CHAT_ATTACHMENTS) {
            setSnack(messages.maxAttachmentsReached.replace('{{max}}', String(MAX_CHAT_ATTACHMENTS)));
            return prev;
          }
          added = true;
          return [...prev, next];
        });
        return added;
      } catch (e) {
        if (e instanceof AttachmentFileError) {
          if (e.code === 'cancelled') return false;
          if (e.code === 'permission_denied') {
            setSnack(source === 'camera'
              ? messages.attachmentCameraPermissionDenied
              : messages.attachmentPermissionDenied);
            return false;
          }
          if (e.code === 'too_large') {
            setSnack(
              messages.attachmentFileTooLarge
                .replace('{{name}}', e.fileName ?? 'file')
                .replace('{{maxSize}}', formatAttachmentSize(MAX_WEBCHAT_ATTACHMENT_FILE_BYTES)),
            );
            return false;
          }
        }
        const fileName = e instanceof AttachmentFileError ? e.fileName : undefined;
        setSnack(messages.attachmentLoadFailed.replace('{{name}}', fileName ?? 'file'));
        return false;
      }
    },
    [messages],
  );

  const openSheet = useCallback(() => setSheetOpen(true), []);
  const closeSheet = useCallback(() => setSheetOpen(false), []);

  const dismissSnack = useCallback(() => setSnack(''), []);

  return {
    attachments,
    sheetOpen,
    snack,
    openSheet,
    closeSheet,
    addFromSource,
    removeAttachment,
    clearAttachments,
    restoreAttachments,
    setAttachments,
    toWirePayload,
    dismissSnack,
    maxAttachments: MAX_CHAT_ATTACHMENTS,
  };
}
