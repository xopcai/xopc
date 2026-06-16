export function isImageInboundAttachment(att: {
  type?: string;
  mimeType?: string;
}): boolean {
  return (
    att.type === 'image' ||
    att.type === 'photo' ||
    att.mimeType?.startsWith('image/') === true
  );
}

export function isVoiceInboundAttachment(att: { type?: string; mimeType?: string }): boolean {
  return (
    att.type === 'voice' ||
    att.type === 'audio' ||
    att.mimeType?.startsWith('audio/') === true
  );
}
