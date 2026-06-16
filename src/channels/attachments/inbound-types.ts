import type { InboundAttachmentInput, MediaRef } from '../../media/types.js';
import {
  isImageInboundAttachment,
  isVoiceInboundAttachment,
} from './attachment-classifiers.js';

export type { InboundAttachmentInput, MediaRef } from '../../media/types.js';
export { isImageInboundAttachment, isVoiceInboundAttachment };

export function toMediaRef(
  att: InboundAttachmentInput,
  saved: { id: string; bucket: MediaRef['bucket']; uri: string; path: string; size: number; contentType: string },
): MediaRef {
  return {
    id: saved.id,
    bucket: saved.bucket,
    type: att.type,
    mimeType: att.mimeType?.trim() || saved.contentType,
    name: att.name?.trim() || 'file',
    size: att.size ?? saved.size,
    uri: saved.uri,
    path: saved.path,
  };
}

export function mediaRefFromUri(
  att: InboundAttachmentInput,
  uri: string,
  path: string,
  bucket: MediaRef['bucket'],
  id: string,
): MediaRef {
  return {
    id,
    bucket,
    type: att.type,
    mimeType: att.mimeType?.trim() || 'application/octet-stream',
    name: att.name?.trim() || 'file',
    size: att.size ?? 0,
    uri,
    path,
  };
}
