export type XopcFilePreviewKind = 'image' | 'audio' | 'video' | 'markdown' | 'html' | 'text' | 'binary';

const XOPC_PREVIEW_MIME_BY_EXTENSION: Record<string, string> = {
  'pdf': 'application/pdf', 'doc': 'application/msword',
  'docx': 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  'xls': 'application/vnd.ms-excel', 'xlsx': 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  'ppt': 'application/vnd.ms-powerpoint', 'pptx': 'application/vnd.openxmlformats-officedocument.presentationml.presentation',
  'zip': 'application/zip', 'json': 'application/json', 'md': 'text/markdown', 'markdown': 'text/markdown',
  'html': 'text/html', 'htm': 'text/html', 'csv': 'text/csv', 'tsv': 'text/tab-separated-values',
  'png': 'image/png', 'jpg': 'image/jpeg', 'jpeg': 'image/jpeg', 'gif': 'image/gif', 'webp': 'image/webp',
  'svg': 'image/svg+xml', 'mp3': 'audio/mpeg', 'wav': 'audio/wav', 'm4a': 'audio/mp4', 'ogg': 'audio/ogg',
  'mp4': 'video/mp4', 'webm': 'video/webm', 'mov': 'video/quicktime'
};

function extensionOf(name: string): string {
  const dot = name.lastIndexOf('.');
  return dot < 0 ? '' : name.slice(dot + 1).toLowerCase();
}

export function normalizedFileMimeType(name: string, mimeType: string): string {
  const normalized = mimeType.split(';')[0].trim().toLowerCase();
  if (normalized && normalized !== 'application/octet-stream') return normalized;
  return XOPC_PREVIEW_MIME_BY_EXTENSION[extensionOf(name)] || normalized || 'application/octet-stream';
}

export function filePreviewKind(name: string, mimeType: string): XopcFilePreviewKind {
  const extension = extensionOf(name);
  const mime = normalizedFileMimeType(name, mimeType);
  if (mime.startsWith('image/') || ['png', 'jpg', 'jpeg', 'gif', 'webp', 'bmp', 'svg', 'avif', 'heic', 'heif', 'tif', 'tiff'].includes(extension)) return 'image';
  if (mime.startsWith('audio/') || ['mp3', 'wav', 'ogg', 'oga', 'aac', 'm4a', 'flac', 'opus'].includes(extension)) return 'audio';
  if (mime.startsWith('video/') || ['mp4', 'webm', 'mov', 'm4v', 'ogv'].includes(extension)) return 'video';
  if (mime === 'text/markdown' || extension === 'md' || extension === 'markdown') return 'markdown';
  if (mime === 'text/html' || extension === 'html' || extension === 'htm') return 'html';
  if (mime.startsWith('text/') || mime === 'application/json' || mime === 'application/xml' || ['txt', 'json', 'jsonc', 'json5', 'css', 'scss', 'less',
    'js', 'mjs', 'cjs', 'ts', 'tsx', 'jsx', 'xml', 'yaml', 'yml', 'toml', 'ini', 'conf', 'properties', 'env', 'csv',
    'tsv', 'log', 'sql', 'py', 'rb', 'java', 'kt', 'swift', 'go', 'rs', 'sh', 'bash', 'zsh'].includes(extension)) return 'text';
  return 'binary';
}

export function previewTextLimit(text: string, limit: number = 100000): string {
  if (text.length <= limit) return text;
  let end = limit;
  const code = text.charCodeAt(end - 1);
  if (code >= 0xD800 && code <= 0xDBFF) end--;
  return text.slice(0, end);
}

export function htmlPreviewTextLimit(text: string): string {
  return text.length <= 4 * 1024 * 1024 ? text : '';
}

// Inline HTML is isolated from the Gateway and phone. Inline scripts may render the document, but they cannot read
// local files, call a network API, submit forms, create frames, or load executable code from another origin.
export function safeHtmlPreview(html: string): string {
  const policy = "default-src 'none'; script-src 'unsafe-inline' blob:; connect-src 'none'; img-src data: blob: https:; media-src data: blob: https:; font-src data: https:; style-src 'unsafe-inline' https:; object-src 'none'; form-action 'none'; base-uri 'none'; frame-src 'none'";
  const meta = '<meta charset="utf-8"><meta http-equiv="Content-Security-Policy" content="' + policy
    + '"><meta name="viewport" content="width=device-width,initial-scale=1"><style>html,body{min-height:100%;margin:0;padding:0}body{box-sizing:border-box;background:#fff;color:#111;overflow-wrap:anywhere}*,*:before,*:after{box-sizing:inherit}img,video,canvas,svg{max-width:100%;height:auto}</style>';
  if (/<head[\s>]/i.test(html)) return html.replace(/<head([^>]*)>/i, '<head$1>' + meta);
  return '<!doctype html><html><head>' + meta + '</head><body>' + html + '</body></html>';
}
