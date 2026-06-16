import { useMemo, useRef, useState } from 'react';

import type { MessageAttachment } from '@/features/chat/messages/messages.types';
import {
  base64ToArrayBuffer,
  extractTextForPreview,
  getAttachmentBinaryPayload,
  inferAttachmentFileType,
  PPTX_PREVIEW_MAX_CHARS,
  type AttachmentPreviewFileType,
} from '@/features/chat/attachments/attachment-utils-core';
import { fetchMediaUriBuffer } from '@/features/file-preview/fetch-workspace-relative-file';
import { messages } from '@/i18n/messages';
import type { StoredLanguage } from '@/lib/storage';
import type { FilePreviewKind } from '@/features/file-preview/types';
import { useAsyncResource } from '@/lib/use-async-resource';

export type AttachmentPreviewResolved = {
  preview: MessageAttachment | null;
  fileType: AttachmentPreviewFileType;
  previewKind: FilePreviewKind | null;
  fileKey: string;
  fileName: string;

  loading: boolean;
  loadError: string | null;
  clearLoadError: () => void;

  textContent: string | null;
  binaryBuffer: ArrayBuffer | null;

  hasExtractedText: boolean;
  extractedText: string | null;
  extractedTextTruncated: boolean;
  showExtractedText: boolean;
  setShowExtractedText: (v: boolean) => void;
};

function attachmentSourceKey(attachment: MessageAttachment): string {
  return attachment.id ? String(attachment.id) : `${attachment.name}:${attachment.uri ?? ''}`;
}

export function useAttachmentPreviewResolved({
  open,
  attachment,
  authToken,
  sessionKey,
  language,
}: {
  open: boolean;
  attachment: MessageAttachment | null;
  authToken?: string;
  sessionKey?: string | null;
  language: StoredLanguage;
}): AttachmentPreviewResolved {
  const [previewBase, setPreviewBase] = useState<MessageAttachment | null>(null);
  const [showExtractedText, setShowExtractedText] = useState(false);
  const [errorDismissed, setErrorDismissed] = useState(false);

  const sourceKey = open && attachment ? attachmentSourceKey(attachment) : null;
  const trackedSourceKeyRef = useRef(sourceKey);
  if (sourceKey !== trackedSourceKeyRef.current) {
    trackedSourceKeyRef.current = sourceKey;
    setPreviewBase(open && attachment ? attachment : null);
    setShowExtractedText(false);
    setErrorDismissed(false);
  }

  const mediaUri = previewBase?.uri;
  const inlinePayload = previewBase ? getAttachmentBinaryPayload(previewBase) : undefined;
  const fetchEnabled = Boolean(open && mediaUri && !inlinePayload && authToken);

  const gatewayFetch = useAsyncResource(
    async () => {
      const L = messages(language).chat;
      const result = await fetchMediaUriBuffer({ uri: mediaUri!, sessionKey });
      if (!result.ok) {
        if (result.reason === 'http') {
          throw new Error(`${L.attachmentPreviewLoadError} (HTTP ${result.status})`);
        }
        throw new Error(result.message);
      }
      return result.buffer;
    },
    [open, mediaUri, authToken, language, inlinePayload, sessionKey],
    { enabled: fetchEnabled, initial: null as ArrayBuffer | null, errorData: null },
  );

  const missingAuthError =
    open && mediaUri && !inlinePayload && !authToken ? messages(language).chat.attachmentPreviewMissingAuth : null;

  const fetchError = useMemo(() => {
    if (gatewayFetch.error == null) return null;
    if (gatewayFetch.error instanceof Error) return gatewayFetch.error.message;
    return String(gatewayFetch.error);
  }, [gatewayFetch.error]);

  const preview = previewBase;

  const rawLoadError = missingAuthError ?? fetchError;
  const loadError = errorDismissed ? null : rawLoadError;

  const fileType = preview ? inferAttachmentFileType(preview) : 'text';

  const binaryBuffer = useMemo(() => {
    if (inlinePayload) {
      try {
        return base64ToArrayBuffer(inlinePayload);
      } catch {
        return null;
      }
    }
    if (fetchEnabled && gatewayFetch.loading) {
      return null;
    }
    return gatewayFetch.data ?? null;
  }, [inlinePayload, fetchEnabled, gatewayFetch.loading, gatewayFetch.data]);

  const extractedTextRaw = preview ? (extractTextForPreview(preview) ?? '') : '';
  const hasExtractedText = Boolean(preview?.extractedText);

  const extractedText = extractedTextRaw || null;
  const extractedTextTruncated = fileType === 'pptx' && extractedTextRaw.length > PPTX_PREVIEW_MAX_CHARS;

  const { previewKind, textContent } = useMemo((): { previewKind: FilePreviewKind | null; textContent: string | null } => {
    if (!preview) return { previewKind: null, textContent: null };
    if (fileType === 'text') {
      return { previewKind: 'text', textContent: extractedTextRaw || messages(language).chat.attachmentPreviewNoText };
    }
    if (fileType === 'image') {
      return { previewKind: 'image', textContent: null };
    }
    if (fileType === 'pdf') return { previewKind: 'pdf', textContent: null };
    if (fileType === 'docx') return { previewKind: 'docx', textContent: null };
    if (fileType === 'excel') return { previewKind: 'excel', textContent: null };
    if (fileType === 'pptx') return { previewKind: 'pptx', textContent: null };
    return { previewKind: 'text', textContent: extractedTextRaw || messages(language).chat.attachmentPreviewNoText };
  }, [extractedTextRaw, fileType, language, preview]);

  const fileName = preview?.name ?? '';
  const fileKey = preview?.id ? String(preview.id) : `${fileName}:${preview?.uri ?? ''}`;

  return {
    preview,
    fileType,
    previewKind,
    fileKey,
    fileName,
    loading: fetchEnabled ? gatewayFetch.loading : false,
    loadError,
    clearLoadError: () => setErrorDismissed(true),
    textContent,
    binaryBuffer,
    hasExtractedText,
    extractedText,
    extractedTextTruncated,
    showExtractedText,
    setShowExtractedText,
  };
}
