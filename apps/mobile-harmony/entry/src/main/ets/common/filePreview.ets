export type XopcFilePreviewKind = 'image' | 'audio' | 'video' | 'markdown' | 'html' | 'text' | 'binary';

function extensionOf(name: string): string {
  const dot = name.lastIndexOf('.');
  return dot < 0 ? '' : name.slice(dot + 1).toLowerCase();
}

export function filePreviewKind(name: string, mimeType: string): XopcFilePreviewKind {
  const extension = extensionOf(name);
  if (mimeType.startsWith('image/') || ['png', 'jpg', 'jpeg', 'gif', 'webp', 'bmp', 'svg'].includes(extension)) return 'image';
  if (mimeType.startsWith('audio/')) return 'audio';
  if (mimeType.startsWith('video/')) return 'video';
  if (mimeType === 'text/markdown' || extension === 'md' || extension === 'markdown') return 'markdown';
  if (mimeType === 'text/html' || extension === 'html' || extension === 'htm') return 'html';
  if (mimeType.startsWith('text/') || ['txt', 'json', 'css', 'js', 'mjs', 'cjs', 'ts', 'tsx', 'jsx', 'xml', 'csv', 'log'].includes(extension)) return 'text';
  return 'binary';
}

export function previewTextLimit(text: string, limit: number = 100000): string {
  if (text.length <= limit) return text;
  let end = limit;
  const code = text.charCodeAt(end - 1);
  if (code >= 0xD800 && code <= 0xDBFF) end--;
  return text.slice(0, end);
}

// Inline HTML is isolated from the Gateway and phone: no scripts, network, forms, frames, or file access.
export function safeHtmlPreview(html: string): string {
  const policy = "default-src 'none'; img-src data:; media-src data:; font-src data:; style-src 'unsafe-inline'; form-action 'none'; base-uri 'none'; frame-src 'none'";
  const meta = '<meta http-equiv="Content-Security-Policy" content="' + policy + '"><meta name="viewport" content="width=device-width,initial-scale=1">';
  if (/<head[\s>]/i.test(html)) return html.replace(/<head([^>]*)>/i, '<head$1>' + meta);
  return '<!doctype html><html><head>' + meta + '</head><body>' + html + '</body></html>';
}
