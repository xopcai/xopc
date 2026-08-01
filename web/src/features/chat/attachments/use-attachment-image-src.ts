import { useEffect, useMemo, useState } from 'react';

import type { MessageAttachment } from '@/features/chat/messages/messages.types';
import {
  getAttachmentBinaryPayload,
  resolveDataUrlForDisplay,
} from '@/features/chat/attachments/attachment-utils-core';
import { fetchMediaUriBlob } from '@/features/preview-runtime/media-fetch';

function blobWithAttachmentMime(blob: Blob, mimeType: string | undefined): Blob {
  const normalized = mimeType?.split(';')[0]?.trim();
  if (!normalized?.startsWith('image/')) {
    return blob;
  }
  if (blob.type === normalized) {
    return blob;
  }
  return new Blob([blob], { type: normalized });
}

/**
 * Image thumbnail src for chat attachments.
 * - Composer / optimistic: in-memory base64 → data URL
 * - Persisted: gateway fetch → blob object URL (revoked on unmount)
 */
export function useAttachmentImageSrc(
  attachment: MessageAttachment,
  opts: { authToken?: string; sessionKey?: string | null },
): { src: string; error: boolean } {
  const isImage =
    attachment.type === 'image' ||
    attachment.mimeType?.startsWith('image/') === true;

  const inlinePayload = isImage ? getAttachmentBinaryPayload(attachment) : undefined;

  const inlineSrc = useMemo(() => {
    if (!inlinePayload) return undefined;
    const mime = attachment.mimeType?.startsWith('image/') ? attachment.mimeType : 'image/png';
    return resolveDataUrlForDisplay(mime, inlinePayload);
  }, [inlinePayload, attachment.mimeType]);

  const requestKey = `${attachment.uri ?? ''}\n${opts.sessionKey ?? ''}`;
  const [remote, setRemote] = useState<{
    key: string;
    blobUrl?: string;
    status: 'loading' | 'loaded' | 'error';
  }>();

  useEffect(() => {
    if (inlineSrc || !attachment.uri || !isImage) {
      setRemote(undefined);
      return;
    }
    if (!String(opts.authToken ?? '').trim()) {
      setRemote(undefined);
      return;
    }

    let revoke: string | undefined;
    let cancelled = false;
    setRemote({ key: requestKey, status: 'loading' });

    void (async () => {
      const result = await fetchMediaUriBlob({ uri: attachment.uri!, sessionKey: opts.sessionKey });
      if (cancelled) return;
      if (!result.ok) {
        setRemote({ key: requestKey, status: 'error' });
        return;
      }
      const u = URL.createObjectURL(blobWithAttachmentMime(result.blob, attachment.mimeType));
      revoke = u;
      setRemote({ key: requestKey, blobUrl: u, status: 'loaded' });
    })();

    return () => {
      cancelled = true;
      if (revoke) URL.revokeObjectURL(revoke);
    };
  }, [inlineSrc, attachment.uri, isImage, opts.authToken, opts.sessionKey, requestKey]);

  const activeRemote = remote?.key === requestKey ? remote : undefined;
  return {
    src: inlineSrc ?? activeRemote?.blobUrl ?? '',
    error: !inlineSrc && activeRemote?.status === 'error',
  };
}
