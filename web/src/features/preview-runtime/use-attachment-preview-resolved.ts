import { useMemo, useRef, useState } from 'react';

import type { MessageAttachment } from '@/features/chat/messages/messages.types';
import {
  base64ToArrayBuffer,
  getAttachmentBinaryPayload,
  PPTX_PREVIEW_MAX_CHARS,
} from '@/features/chat/attachments/attachment-utils-core';
import {
  detectPreviewFileType,
  inferPreviewMimeType,
  readModeForPreviewType,
} from '@/features/preview-runtime/detect-preview-file';
import { fetchMediaUriBuffer } from '@/features/preview-runtime/media-fetch';
import type {
  PreviewFileDescriptor,
  PreviewFileType,
  PreviewLoadedSource,
} from '@/features/preview-runtime/preview-types';
import { messages } from '@/i18n/messages';
import type { StoredLanguage } from '@/lib/storage';
import { useAsyncResource } from '@/lib/use-async-resource';

export type AttachmentPreviewResolved = PreviewLoadedSource & {
  downloadBuffer: ArrayBuffer | null;
  preview: MessageAttachment | null;
  fileType: PreviewFileType;
  fileName: string;
  hasExtractedText: boolean;
  extractedText: string | null;
  extractedTextTruncated: boolean;
  showExtractedText: boolean;
  setShowExtractedText: (v: boolean) => void;
  clearLoadError: () => void;
};

function attachmentSourceKey(attachment: MessageAttachment): string {
  return attachment.id ? String(attachment.id) : `${attachment.name}:${attachment.uri ?? ''}`;
}

function emptyDescriptor(): PreviewFileDescriptor {
  return {
    id: '__empty__',
    context: 'attachment',
    fileName: '',
    mimeType: 'application/octet-stream',
    type: 'unsupported',
    source: { kind: 'inline' },
  };
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
  const [previewBase, setPreviewBase] = useState<MessageAttachment | null>(open ? attachment : null);
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

  const preview = previewBase;
  const descriptor = useMemo((): PreviewFileDescriptor => {
    if (!preview) return emptyDescriptor();
    const fileName = preview.name ?? 'attachment';
    const mimeType = inferPreviewMimeType(fileName, preview.mimeType);
    const type = detectPreviewFileType(fileName, mimeType);
    return {
      id: preview.id ? String(preview.id) : `${fileName}:${preview.uri ?? ''}`,
      context: 'attachment',
      fileName,
      mimeType,
      size: preview.size,
      type,
      source: preview.uri ? { kind: 'media-uri', uri: preview.uri, sessionKey } : { kind: 'inline' },
    };
  }, [preview, sessionKey]);

  const inlinePayload = preview ? getAttachmentBinaryPayload(preview) : undefined;
  const mediaUri = preview?.uri;
  const readMode = readModeForPreviewType(descriptor.type);
  const fetchEnabled = Boolean(
    open && mediaUri && !inlinePayload && authToken && (readMode === 'binary' || readMode === 'text'),
  );

  const gatewayFetch = useAsyncResource(
    async () => {
      const L = messages(language).chat;
      const result = await fetchMediaUriBuffer({ uri: mediaUri!, sessionKey, taskId: preview?.taskId });
      if (!result.ok) {
        if (result.reason === 'http') throw new Error(`${L.attachmentPreviewLoadError} (HTTP ${result.status})`);
        throw new Error(result.message);
      }
      return result.buffer;
    },
    [open, mediaUri, authToken, language, inlinePayload, preview?.taskId, sessionKey, readMode],
    { enabled: fetchEnabled, initial: null as ArrayBuffer | null, errorData: null },
  );

  const downloadBuffer = useMemo(() => {
    if (inlinePayload) {
      try {
        return base64ToArrayBuffer(inlinePayload);
      } catch {
        return null;
      }
    }
    if (fetchEnabled && gatewayFetch.loading) return null;
    return gatewayFetch.data ?? null;
  }, [fetchEnabled, gatewayFetch.data, gatewayFetch.loading, inlinePayload]);

  const binaryBuffer = readMode === 'binary' ? downloadBuffer : null;

  const extractedTextRaw = preview?.extractedText ?? '';
  const textContent = readMode === 'text'
    ? extractedTextRaw
      || (downloadBuffer
        ? new TextDecoder('utf-8', { fatal: false }).decode(new Uint8Array(downloadBuffer))
        : messages(language).chat.attachmentPreviewNoText)
    : null;
  const hasExtractedText = Boolean(preview?.extractedText);
  const extractedTextTruncated = descriptor.type === 'pptx' && extractedTextRaw.length > PPTX_PREVIEW_MAX_CHARS;

  const missingAuthError =
    open && mediaUri && !inlinePayload && !authToken && readMode === 'binary'
      ? messages(language).chat.attachmentPreviewMissingAuth
      : null;
  const fetchError = gatewayFetch.error
    ? gatewayFetch.error instanceof Error
      ? gatewayFetch.error.message
      : String(gatewayFetch.error)
    : null;
  const loadError = errorDismissed ? null : (missingAuthError ?? fetchError);

  return {
    preview,
    descriptor,
    fileType: descriptor.type,
    fileName: descriptor.fileName,
    loading: fetchEnabled ? gatewayFetch.loading : false,
    loadError,
    clearLoadError: () => setErrorDismissed(true),
    textContent,
    binaryBuffer,
    downloadBuffer,
    hasExtractedText,
    extractedText: extractedTextRaw || null,
    extractedTextTruncated,
    showExtractedText,
    setShowExtractedText,
  };
}
