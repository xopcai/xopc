/**
 * Media MIME Type Utilities
 */

const EXT_TO_MIME: Record<string, string> = {
  jpg: 'image/jpeg',
  jpeg: 'image/jpeg',
  png: 'image/png',
  gif: 'image/gif',
  webp: 'image/webp',
  bmp: 'image/bmp',
  svg: 'image/svg+xml',
  mp4: 'video/mp4',
  mov: 'video/quicktime',
  avi: 'video/x-msvideo',
  webm: 'video/webm',
  mp3: 'audio/mpeg',
  wav: 'audio/wav',
  ogg: 'audio/ogg',
  pdf: 'application/pdf',
  doc: 'application/msword',
  docx: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  txt: 'text/plain',
  zip: 'application/zip',
};

const TYPE_TO_MIME: Record<string, string> = {
  photo: 'image/jpeg',
  video: 'video/mp4',
  audio: 'audio/mpeg',
  document: 'application/octet-stream',
  sticker: 'image/webp',
};

/**
 * Get MIME type from file extension or type
 */
export function getMimeType(type: string, filePath?: string): string {
  // Try to get from file extension
  if (filePath) {
    const ext = filePath.split('.').pop()?.toLowerCase();
    if (ext && EXT_TO_MIME[ext]) {
      return EXT_TO_MIME[ext];
    }
  }

  // Fallback based on type
  return TYPE_TO_MIME[type] || 'application/octet-stream';
}

/**
 * Get media category from MIME type
 */
export function getMediaCategory(mimeType: string): 'image' | 'video' | 'audio' | 'document' {
  const category = mimeType.split('/')[0];
  if (category === 'image') return 'image';
  if (category === 'video') return 'video';
  if (category === 'audio') return 'audio';
  return 'document';
}
