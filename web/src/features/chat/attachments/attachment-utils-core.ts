/** Max files per chat message (keep in sync with `src/gateway/chat-limits.ts`). */
export const MAX_CHAT_ATTACHMENTS = 10;

/** Excel preview row/column caps — keep in sync with `attachment-preview-renderer` table builder. */
export const EXCEL_PREVIEW_MAX_ROWS = 500;
export const EXCEL_PREVIEW_MAX_COLS = 64;

/** PPTX: cap text shown in preview dialog to avoid freezing the browser on huge decks. */
export const PPTX_PREVIEW_MAX_CHARS = 300_000;

/** Build gateway read URL for a `media://` URI. */
export function mediaUriToReadUrl(
  uri: string,
  sessionKey?: string | null,
  taskId?: string | null,
): string {
  const params = new URLSearchParams({ uri: uri.trim() });
  if (sessionKey?.trim()) {
    params.set('sessionKey', sessionKey.trim());
  }
  if (taskId?.trim()) {
    params.set('taskId', taskId.trim());
  }
  return `/api/media/read?${params.toString()}`;
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
  /** Persisted media URI (`media://inbound/…`, `media://tts/…`). */
  uri?: string;
  durationSeconds?: number;
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
 * When MIME is missing or generic, infer a concrete type from the file name (for session wire normalization).
 */
export function inferMimeTypeFromFileName(fileName: string): string | undefined {
  const lower = fileName.toLowerCase();
  const map: Array<[string, string]> = [
    ['.pdf', 'application/pdf'],
    ['.docx', 'application/vnd.openxmlformats-officedocument.wordprocessingml.document'],
    ['.pptx', 'application/vnd.openxmlformats-officedocument.presentationml.presentation'],
    ['.xlsx', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'],
    ['.xls', 'application/vnd.ms-excel'],
    ['.png', 'image/png'],
    ['.jpg', 'image/jpeg'],
    ['.jpeg', 'image/jpeg'],
    ['.gif', 'image/gif'],
    ['.webp', 'image/webp'],
    ['.bmp', 'image/bmp'],
    ['.svg', 'image/svg+xml'],
    ['.svgz', 'image/svg+xml'],
    ['.ico', 'image/x-icon'],
    ['.tif', 'image/tiff'],
    ['.tiff', 'image/tiff'],
    ['.avif', 'image/avif'],
    ['.jxl', 'image/jxl'],
  ];
  for (const [ext, mime] of map) {
    if (lower.endsWith(ext)) return mime;
  }
  return undefined;
}

export function isTextLikeFileNameAndMime(name: string, mimeType: string): boolean {
  const isTextFile =
    (mimeType?.startsWith('text/') ?? false) ||
    TEXT_FILE_EXTENSIONS.some((ext) => name.toLowerCase().endsWith(ext));
  return isTextFile;
}
