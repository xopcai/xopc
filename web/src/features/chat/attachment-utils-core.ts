/** Max files per chat message (keep in sync with `src/gateway/chat-limits.ts`). */
export const MAX_CHAT_ATTACHMENTS = 10;

/** Excel preview row/column caps — keep in sync with `attachment-preview-renderer` table builder. */
export const EXCEL_PREVIEW_MAX_ROWS = 500;
export const EXCEL_PREVIEW_MAX_COLS = 64;

/** PPTX: cap text shown in preview dialog to avoid freezing the browser on huge decks. */
export const PPTX_PREVIEW_MAX_CHARS = 300_000;

/** Path for gateway `GET` (inbound vs TTS); `rel` is relative to agent home (`inbound/…`, `tts/…`). */
export function workspaceRelativePathToApiPath(
  rel: string,
  opts?: { sessionKey?: string | null },
): string {
  const norm = rel.replace(/\\/g, '/');
  const q = encodeURIComponent(norm);
  const base = norm.startsWith('tts/')
    ? `/api/workspace/tts-file?rel=${q}`
    : `/api/workspace/inbound-file?rel=${q}`;
  const sk = opts?.sessionKey?.trim();
  if (!sk) return base;
  return `${base}&sessionKey=${encodeURIComponent(sk)}`;
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
  /** Server-persisted path under agent home (`inbound/…` or `tts/…`; gateway with `?sessionKey=` when needed) */
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

/** View kind for the attachment preview dialog — mirrors `loadAttachment` detection (MIME + extension). */
export type AttachmentPreviewFileType =
  | 'image'
  | 'pdf'
  | 'docx'
  | 'pptx'
  | 'excel'
  | 'text';

/**
 * Infer how to preview an attachment (wire payloads often use `application/octet-stream`).
 * Order matches [`loadAttachment`](./attachment-load.ts): office types before generic image extension fallback.
 */
export function inferAttachmentFileType(att: {
  name?: string;
  mimeType?: string;
  type?: string;
}): AttachmentPreviewFileType {
  const rawMime = att.mimeType ?? '';
  const mime = rawMime.toLowerCase();
  const baseMime = mime.split(';')[0]?.trim() ?? '';
  const name = att.name?.toLowerCase() ?? '';

  if (att.type === 'image' || baseMime.startsWith('image/')) {
    return 'image';
  }

  if (baseMime === 'application/pdf' || mime.includes('application/pdf') || name.endsWith('.pdf')) {
    return 'pdf';
  }

  if (
    baseMime === 'application/vnd.openxmlformats-officedocument.wordprocessingml.document' ||
    mime.includes('wordprocessingml') ||
    name.endsWith('.docx')
  ) {
    return 'docx';
  }

  if (
    baseMime === 'application/vnd.openxmlformats-officedocument.presentationml.presentation' ||
    mime.includes('presentationml') ||
    name.endsWith('.pptx')
  ) {
    return 'pptx';
  }

  const excelMimeTypes = [
    'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
    'application/vnd.ms-excel',
  ];
  if (
    excelMimeTypes.includes(baseMime) ||
    mime.includes('spreadsheetml') ||
    mime.includes('ms-excel') ||
    name.endsWith('.xlsx') ||
    name.endsWith('.xls')
  ) {
    return 'excel';
  }

  const imageExt = ['.jpg', '.jpeg', '.png', '.gif', '.webp', '.bmp', '.svg'];
  if (imageExt.some((ext) => name.endsWith(ext))) {
    return 'image';
  }

  return 'text';
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
  ];
  for (const [ext, mime] of map) {
    if (lower.endsWith(ext)) return mime;
  }
  return undefined;
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
