/** Max files per chat message (keep in sync with `src/gateway/chat-limits.ts`). */
export const MAX_CHAT_ATTACHMENTS = 10;

/** Path under workspace for gateway `GET` (inbound vs TTS). */
export function workspaceRelativePathToApiPath(rel: string): string {
  const q = encodeURIComponent(rel.replace(/\\/g, '/'));
  if (rel.replace(/\\/g, '/').startsWith('.xopcbot/tts/')) {
    return `/api/workspace/tts-file?rel=${q}`;
  }
  return `/api/workspace/inbound-file?rel=${q}`;
}

export interface Attachment {
  id?: string;
  type: 'image' | 'document' | 'voice';
  name: string;
  mimeType: string;
  size: number;
  content: string; // base64 encoded original data (without data URL prefix)
  /** Wire/API payloads may use `data` instead of `content` */
  data?: string;
  extractedText?: string; // For documents: extracted text content
  preview?: string; // base64 image preview (first page for PDFs, or same as content for images)
  /** Server-persisted path under workspace (gateway `/api/workspace/inbound-file`) */
  workspaceRelativePath?: string;
}

/** Prefer `content`, then `data` (gateway / webchat wire format). */
export function getAttachmentBinaryPayload(att: {
  content?: string;
  data?: string;
}): string | undefined {
  if (typeof att.content === 'string' && att.content.length > 0) return att.content;
  if (typeof att.data === 'string' && att.data.length > 0) return att.data;
  return undefined;
}

/** Same list as `loadAttachment` text branch — keep in sync for preview decode. */
export const TEXT_FILE_EXTENSIONS = [
  '.txt',
  '.md',
  '.json',
  '.xml',
  '.html',
  '.css',
  '.js',
  '.ts',
  '.jsx',
  '.tsx',
  '.yml',
  '.yaml',
] as const;

function isLikelyTextLikeFile(att: { name?: string; mimeType?: string }): boolean {
  const mime = att.mimeType?.toLowerCase() ?? '';
  if (mime.startsWith('text/')) return true;
  if (
    mime === 'application/json' ||
    mime === 'application/xml' ||
    mime === 'application/javascript' ||
    mime === 'application/typescript'
  ) {
    return true;
  }
  const lower = att.name?.toLowerCase() ?? '';
  return TEXT_FILE_EXTENSIONS.some((ext) => lower.endsWith(ext));
}

/**
 * Text for overlay preview: prefers `extractedText`, otherwise decodes UTF-8 from base64
 * when the attachment is a text-like file (e.g. .md). Webchat only sends `data`, not
 * `extractedText`, so previews would otherwise show empty.
 */
export function extractTextForPreview(att: {
  name?: string;
  mimeType?: string;
  content?: string;
  data?: string;
  extractedText?: string;
}): string | undefined {
  if (att.extractedText != null && att.extractedText !== '') {
    return att.extractedText;
  }
  if (!isLikelyTextLikeFile(att)) return undefined;
  const payload = getAttachmentBinaryPayload(att);
  if (!payload) return undefined;
  try {
    const buf = base64ToArrayBuffer(payload);
    return new TextDecoder('utf-8', { fatal: false }).decode(new Uint8Array(buf));
  } catch {
    return undefined;
  }
}

/**
 * Build a valid `data:` URL for `<img src>` / preview.
 * If payload is already a data URL, returns it unchanged.
 * Otherwise strips whitespace from base64 and uses `mime` (falls back if invalid).
 */
export function resolveDataUrlForDisplay(mime: string, payload: string): string {
  const trimmed = payload.trim();
  if (trimmed.startsWith('data:')) {
    return trimmed;
  }
  const compact = trimmed.replace(/\s/g, '');
  const mimeSafe =
    mime && typeof mime === 'string' && mime.includes('/') ? mime : 'application/octet-stream';
  return `data:${mimeSafe};base64,${compact}`;
}

/** Encode binary as base64 (chunked for large buffers). */
export function arrayBufferToBase64(buffer: ArrayBuffer): string {
  const bytes = new Uint8Array(buffer);
  let binary = '';
  const chunkSize = 0x8000;
  for (let i = 0; i < bytes.length; i += chunkSize) {
    const chunk = bytes.subarray(i, i + chunkSize);
    binary += String.fromCharCode(...chunk);
  }
  return btoa(binary);
}

/**
 * Convert base64 to ArrayBuffer
 */
export function base64ToArrayBuffer(base64: string | undefined | null): ArrayBuffer {
  if (base64 == null || base64 === '') {
    throw new Error('Missing file data');
  }
  // Remove data URL prefix if present
  let base64Data = base64;
  if (base64.startsWith('data:')) {
    const base64Match = base64.match(/base64,(.+)/);
    if (base64Match) {
      base64Data = base64Match[1];
    }
  }

  const binaryString = atob(base64Data);
  const bytes = new Uint8Array(binaryString.length);
  for (let i = 0; i < binaryString.length; i++) {
    bytes[i] = binaryString.charCodeAt(i);
  }
  return bytes.buffer;
}

/**
 * Get file icon based on mime type
 */
export function getFileIcon(mimeType: string): string {
  if (!mimeType) return '📎';
  if (mimeType.includes('pdf')) return '📄';
  if (mimeType.includes('word') || mimeType.includes('document')) return '📝';
  if (mimeType.includes('sheet') || mimeType.includes('excel')) return '📊';
  if (mimeType.includes('presentation') || mimeType.includes('powerpoint')) return '📽️';
  if (mimeType.startsWith('image/')) return '🖼️';
  if (mimeType.startsWith('text/') || mimeType.includes('json')) return '📃';
  return '📎';
}

/**
 * Format file size
 */
export function formatFileSize(bytes: number): string {
  const units = ['B', 'KB', 'MB', 'GB'];
  let unitIndex = 0;
  let size = bytes;
  while (size >= 1024 && unitIndex < units.length - 1) {
    size /= 1024;
    unitIndex++;
  }
  return `${size.toFixed(1)} ${units[unitIndex]}`;
}

/**
 * Check if file is an image
 */
export function isImageFile(mimeType: string): boolean {
  return Boolean(mimeType?.startsWith('image/'));
}

/**
 * Check if file is a document that can be previewed
 */
export function isPreviewableDocument(mimeType: string, name?: string): boolean {
  const previewableTypes = [
    'application/pdf',
    'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
    'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
    'application/vnd.openxmlformats-officedocument.presentationml.presentation',
    'text/plain',
    'text/markdown',
    'text/html',
    'application/json',
    'text/xml',
  ];

  if (previewableTypes.includes(mimeType)) return true;

  if (name) {
    const ext = name.toLowerCase().split('.').pop();
    const previewableExts = [
      'pdf',
      'docx',
      'xlsx',
      'xls',
      'pptx',
      'txt',
      'md',
      'json',
      'xml',
      'html',
      'css',
      'js',
      'ts',
    ];
    if (ext && previewableExts.includes(ext)) return true;
  }

  return false;
}

export function isTextLikeFileNameAndMime(name: string, mimeType: string): boolean {
  const isTextFile =
    (mimeType?.startsWith('text/') ?? false) ||
    TEXT_FILE_EXTENSIONS.some((ext) => name.toLowerCase().endsWith(ext));
  return isTextFile;
}
