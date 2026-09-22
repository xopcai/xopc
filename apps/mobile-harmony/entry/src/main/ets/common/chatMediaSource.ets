import { markdownLink } from './markdown';
import { decodeBase64Url } from './protocol';

export interface XopcChatMediaSource { path: string; external: boolean; data?: ArrayBuffer; }
export const CHAT_MEDIA_LIMIT: number = 16 * 1024 * 1024;

export function chatMediaSource(uri: string, conversationId: string): XopcChatMediaSource {
  if (uri.startsWith('data:')) {
    const match = uri.match(/^data:([a-zA-Z0-9.+/-]+);base64,([A-Za-z0-9+/=\s_-]+)$/);
    if (!match || (!/^(image|audio|video)\//.test(match[1]) && !['text/plain', 'text/markdown', 'text/html', 'text/csv', 'application/json', 'application/pdf'].includes(match[1]))
      || match[2].length > CHAT_MEDIA_LIMIT * 1.4) throw new Error('INVALID_MEDIA_OR_TOO_LARGE');
    const encoded = match[2].replace(/\s/g, '').replace(/=+$/, '').replace(/\+/g, '-').replace(/\//g, '_');
    const bytes = decodeBase64Url(encoded);
    if (bytes.byteLength > CHAT_MEDIA_LIMIT) throw new Error('INVALID_MEDIA_OR_TOO_LARGE');
    return { path: '', external: false, data: bytes.buffer as ArrayBuffer };
  }
  if (uri.startsWith('xopc-file:')) {
    const id = decodeURIComponent(uri.slice(10)).trim();
    if (!id) throw new Error('INVALID_MEDIA');
    return { path: '/api/files/' + encodeURIComponent(id) + '/content', external: false };
  }
  if (uri.startsWith('media://') && conversationId) return {
    path: '/api/media/read?uri=' + encodeURIComponent(uri) + '&conversationId=' + encodeURIComponent(conversationId), external: false };
  if (uri.startsWith('https://') && markdownLink(uri)) return { path: uri, external: true };
  // Never pass arbitrary transcript paths to the phone filesystem or authenticated HTTP client.
  throw new Error('INVALID_MEDIA');
}
