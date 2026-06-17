const VISION_IMAGE_MIME_TYPES = new Set([
  'image/jpeg',
  'image/png',
  'image/gif',
  'image/webp',
]);

export function isSupportedVisionImageMimeType(mimeType: string | undefined): boolean {
  const normalized = mimeType?.split(';')[0]?.trim().toLowerCase();
  return normalized ? VISION_IMAGE_MIME_TYPES.has(normalized) : false;
}

export function isImageInboundAttachment(att: {
  type?: string;
  mimeType?: string;
}): boolean {
  if (att.mimeType) {
    return isSupportedVisionImageMimeType(att.mimeType);
  }

  return (
    att.type === 'image' ||
    att.type === 'photo'
  );
}

export function isVoiceInboundAttachment(att: { type?: string; mimeType?: string }): boolean {
  return (
    att.type === 'voice' ||
    att.type === 'audio' ||
    att.mimeType?.startsWith('audio/') === true
  );
}
