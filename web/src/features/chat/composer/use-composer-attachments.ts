import { useCallback, useRef, useState, type MutableRefObject } from 'react';

import type { Attachment } from '@/features/chat/attachments/attachment-utils';
import { formatFileSize, MAX_CHAT_ATTACHMENTS } from '@/features/chat/attachments/attachment-utils';
import type { WireAttachment } from '@/features/chat/composer/composer.types';
import { showComposerNotification } from '@/features/chat/composer/composer-notifications';
import type { PastedTextAttachment } from '@/features/chat/composer/pasted-text';
import { MAX_WEBCHAT_ATTACHMENT_FILE_BYTES } from '@/features/chat/constants';
import type { ChatMessages } from '@/i18n/messages';

export interface UseComposerAttachmentsOptions {
  chat: ChatMessages;
}

export interface UseComposerAttachmentsReturn {
  attachments: Attachment[];
  setAttachments: React.Dispatch<React.SetStateAction<Attachment[]>>;
  attachmentsRef: MutableRefObject<Attachment[]>;
  isDragging: boolean;
  setIsDragging: (v: boolean) => void;
  fileInputRef: MutableRefObject<HTMLInputElement | null>;
  processFiles: (files: File[]) => Promise<void>;
  processPastedText: (paste: PastedTextAttachment) => Promise<void>;
  removeAttachment: (index: number) => void;
  clearAttachments: () => void;
  /** Builds wire payload from current attachments ref (stable — no deps on attachments state). */
  wireAttachmentsPayload: () => WireAttachment[];
}

export function useComposerAttachments(options: UseComposerAttachmentsOptions): UseComposerAttachmentsReturn {
  const { chat: m } = options;
  const [attachments, setAttachments] = useState<Attachment[]>([]);
  const [isDragging, setIsDragging] = useState(false);
  const fileInputRef = useRef<HTMLInputElement | null>(null);
  const attachmentsRef = useRef(attachments);
  attachmentsRef.current = attachments;

  const clearAttachments = useCallback(() => {
    setAttachments([]);
  }, []);

  const removeAttachment = useCallback((index: number) => {
    setAttachments((a) => a.filter((_, i) => i !== index));
  }, []);

  const wireAttachmentsPayload = useCallback((): WireAttachment[] => {
    return attachmentsRef.current.map((a) => ({
      type: a.type === 'voice' ? 'voice' : a.type || 'file',
      mimeType: a.mimeType,
      data: a.content,
      name: a.name,
      size: a.size,
      ...(a.uri ? { uri: a.uri } : {}),
      ...(typeof a.durationSeconds === 'number' &&
      Number.isFinite(a.durationSeconds) &&
      a.durationSeconds > 0
        ? { durationSeconds: a.durationSeconds }
        : {}),
    }));
  }, []);

  const appendFiles = useCallback(
    async (files: File[], typeOverride?: Attachment['type']) => {
      if (files.length === 0) return;
      const remaining = MAX_CHAT_ATTACHMENTS - attachmentsRef.current.length;
      if (remaining <= 0) {
        showComposerNotification('warning', m.maxAttachmentsReached, { max: MAX_CHAT_ATTACHMENTS });
        return;
      }
      const slice = files.slice(0, remaining);
      if (files.length > slice.length) {
        showComposerNotification('warning', m.maxAttachmentsTruncated, {
          max: MAX_CHAT_ATTACHMENTS,
          dropped: files.length - slice.length,
        });
      }
      const { loadAttachment } = await import('@/features/chat/attachments/attachment-load');
      const loaded = await Promise.all(
        slice.map(async (file) => {
          if (file.size > MAX_WEBCHAT_ATTACHMENT_FILE_BYTES) {
            showComposerNotification('warning', m.attachmentFileTooLarge, {
              name: file.name,
              maxSize: formatFileSize(MAX_WEBCHAT_ATTACHMENT_FILE_BYTES),
            });
            return null;
          }
          try {
            return await loadAttachment(file, file.name);
          } catch {
            showComposerNotification('error', m.attachmentLoadFailed, { name: file.name });
            return null;
          }
        }),
      );
      const next = loaded
        .filter((a): a is Attachment => a !== null)
        .map((attachment) => (typeOverride ? { ...attachment, type: typeOverride } : attachment));
      setAttachments((a) => [...a, ...next]);
    },
    [m.attachmentFileTooLarge, m.attachmentLoadFailed, m.maxAttachmentsReached, m.maxAttachmentsTruncated],
  );

  const processFiles = useCallback((files: File[]) => appendFiles(files), [appendFiles]);

  const processPastedText = useCallback(
    (paste: PastedTextAttachment) =>
      appendFiles([new File([paste.text], paste.name, { type: paste.mimeType })], 'pasted_text'),
    [appendFiles],
  );

  return {
    attachments,
    setAttachments,
    attachmentsRef,
    isDragging,
    setIsDragging,
    fileInputRef,
    processFiles,
    processPastedText,
    removeAttachment,
    clearAttachments,
    wireAttachmentsPayload,
  };
}
