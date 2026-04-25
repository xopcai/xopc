import { useEffect, useMemo, useState } from 'react';

import type { MessageAttachment } from '@/features/chat/messages.types';
import {
  base64ToArrayBuffer,
  extractTextForPreview,
  getAttachmentBinaryPayload,
  inferAttachmentFileType,
  PPTX_PREVIEW_MAX_CHARS,
  type AttachmentPreviewFileType,
} from '@/features/chat/attachment-utils-core';
import { fetchWorkspaceRelativeFileAsBase64 } from '@/features/file-preview/fetch-workspace-relative-file-base64';
import { messages } from '@/i18n/messages';
import type { StoredLanguage } from '@/lib/storage';
import type { FilePreviewKind } from '@/features/file-preview/types';

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
  const [preview, setPreview] = useState<MessageAttachment | null>(null);
  const [showExtractedText, setShowExtractedText] = useState(false);
  const [loadingGateway, setLoadingGateway] = useState(false);
  const [fetchError, setFetchError] = useState<string | null>(null);

  useEffect(() => {
    if (open && attachment) {
      setPreview(attachment);
      setShowExtractedText(false);
      setFetchError(null);
    }
  }, [open, attachment]);

  useEffect(() => {
    if (!open || !preview) return;
    const path = preview.workspaceRelativePath;
    const hasPayload = Boolean(getAttachmentBinaryPayload(preview));
    if (!path || hasPayload) {
      setLoadingGateway(false);
      return;
    }
    if (!authToken) {
      setFetchError(messages(language).chat.attachmentPreviewMissingAuth);
      setLoadingGateway(false);
      return;
    }

    let cancelled = false;
    setLoadingGateway(true);
    setFetchError(null);
    const L = messages(language).chat;

    void (async () => {
      try {
        const result = await fetchWorkspaceRelativeFileAsBase64({ workspaceRelativePath: path, sessionKey });
        if (cancelled) return;
        if (!result.ok) {
          if (result.reason === 'http') {
            setFetchError(`${L.attachmentPreviewLoadError} (HTTP ${result.status})`);
          } else {
            setFetchError(result.message);
          }
          return;
        }
        setPreview((prev) => (prev ? { ...prev, content: result.base64, data: result.base64 } : prev));
      } finally {
        if (!cancelled) {
          setLoadingGateway(false);
        }
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [open, preview?.workspaceRelativePath, authToken, language, sessionKey, preview]);

  const fileType = preview ? inferAttachmentFileType(preview) : 'text';

  const payload = preview ? getAttachmentBinaryPayload(preview) : null;
  const binaryBuffer = useMemo(() => {
    if (!payload) return null;
    try {
      return base64ToArrayBuffer(payload);
    } catch {
      return null;
    }
  }, [payload]);

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
  const fileKey = preview?.id ? String(preview.id) : `${fileName}:${preview?.workspaceRelativePath ?? ''}`;

  return {
    preview,
    fileType,
    previewKind,
    fileKey,
    fileName,
    loading: loadingGateway,
    loadError: fetchError,
    clearLoadError: () => setFetchError(null),
    textContent,
    binaryBuffer,
    hasExtractedText,
    extractedText,
    extractedTextTruncated,
    showExtractedText,
    setShowExtractedText,
  };
}

