import { http } from '@kit.NetworkKit';
import { common } from '@kit.AbilityKit';
import { fileIo as fs, picker } from '@kit.CoreFileKit';
import { gatewaySession } from './gatewaySession';
import { XopcHistoryMedia } from '../model/chat';
import { XopcHttpError } from './transport';
import { CHAT_MEDIA_LIMIT, chatMediaSource } from '../common/chatMediaSource';
import { XopcFileSpaceResult, XopcFileResult } from '../model/files';

interface XopcChatMediaHeaders { Authorization: string; }
interface XopcChatFileResolve { spaceId: string; path: string; }
interface XopcMediaCacheEntry { bytes: ArrayBuffer; expires: number; }
const mediaCache = new Map<string, XopcMediaCacheEntry>();
const mediaPending = new Map<string, Promise<ArrayBuffer>>();
let mediaCacheRevision: number = -1;
let mediaCacheGeneration: number = 0;
let mediaCacheSize: number = 0;

export function clearChatMediaCache(): void {
  mediaCache.clear(); mediaPending.clear(); mediaCacheSize = 0; mediaCacheGeneration++;
}

export async function readChatMedia(file: XopcHistoryMedia, conversationId: string): Promise<ArrayBuffer> {
  if (file.size > CHAT_MEDIA_LIMIT) throw new Error('INVALID_MEDIA_OR_TOO_LARGE');
  const revision = gatewaySession.connectionRevision();
  gatewaySession.assertConnection(revision);
  if (mediaCacheRevision !== revision) { clearChatMediaCache(); mediaCacheRevision = revision; }
  // Embedded payloads already live in message memory. Do not retain another copy.
  if (file.uri.startsWith('data:')) return fetchChatMedia(file, conversationId);
  const key = JSON.stringify([conversationId, file.uri, file.workspaceRelativePath || '']);
  const cached = mediaCache.get(key);
  if (cached && cached.expires > Date.now()) { mediaCache.delete(key); mediaCache.set(key, cached); return cached.bytes.slice(0); }
  if (cached) { mediaCacheSize -= cached.bytes.byteLength; mediaCache.delete(key); }
  let pending = mediaPending.get(key);
  if (!pending) {
    const generation = mediaCacheGeneration;
    pending = fetchChatMedia(file, conversationId).then((bytes: ArrayBuffer): ArrayBuffer => {
      gatewaySession.assertConnection(revision);
      if (generation === mediaCacheGeneration && bytes.byteLength <= 4 * 1024 * 1024) {
        while (mediaCacheSize + bytes.byteLength > CHAT_MEDIA_LIMIT || mediaCache.size >= 32) {
          const first = Array.from(mediaCache.keys())[0]; if (!first) break;
          mediaCacheSize -= mediaCache.get(first)!.bytes.byteLength; mediaCache.delete(first);
        }
        mediaCache.set(key, { bytes, expires: Date.now() + 30000 }); mediaCacheSize += bytes.byteLength;
      }
      return bytes;
    }).finally((): void => { if (generation === mediaCacheGeneration) mediaPending.delete(key); });
    mediaPending.set(key, pending);
  }
  return pending.then((bytes: ArrayBuffer): ArrayBuffer => bytes.slice(0));
}

async function fetchChatMedia(file: XopcHistoryMedia, conversationId: string): Promise<ArrayBuffer> {
  const revision = gatewaySession.connectionRevision();
  if (file.size > CHAT_MEDIA_LIMIT) throw new Error('INVALID_MEDIA_OR_TOO_LARGE');
  let uri = file.uri;
  if (!uri && file.workspaceRelativePath && conversationId) {
    const space = JSON.parse(await gatewaySession.request('/api/files/contexts/session/' + encodeURIComponent(conversationId))) as XopcFileSpaceResult;
    gatewaySession.assertConnection(revision);
    const body: XopcChatFileResolve = { spaceId: space.space.id, path: file.workspaceRelativePath };
    const result = JSON.parse(await gatewaySession.request('/api/files/resolve', 'POST', JSON.stringify(body))) as XopcFileResult;
    gatewaySession.assertConnection(revision);
    uri = 'xopc-file:' + encodeURIComponent(result.resource.id);
  }
  const source = chatMediaSource(uri, conversationId);
  if (source.data) return source.data;
  const auth = source.external ? undefined : await gatewaySession.transferAuth();
  if (!source.external) gatewaySession.assertConnection(revision);
  const request = http.createHttp();
  const headers: XopcChatMediaHeaders | undefined = auth ? { Authorization: 'Bearer ' + auth.token } : undefined;
  try {
    // Never attach the gateway token to a URL supplied in a transcript.
    const result = await request.request(source.external ? source.path : auth!.origin + source.path, { method: http.RequestMethod.GET, header: headers,
      expectDataType: http.HttpDataType.ARRAY_BUFFER, maxRedirects: 0, maxLimit: CHAT_MEDIA_LIMIT,
      connectTimeout: 8000, readTimeout: 30000, usingCache: false });
    if (result.responseCode !== 200) throw new XopcHttpError(result.responseCode);
    const bytes = result.result;
    if (!(bytes instanceof ArrayBuffer) || bytes.byteLength > CHAT_MEDIA_LIMIT) throw new Error('INVALID_MEDIA_OR_TOO_LARGE');
    return bytes;
  } finally { request.destroy(); }
}

export async function saveChatMedia(context: common.Context, file: XopcHistoryMedia, conversationId: string): Promise<void> {
  // Fetch successfully before the picker creates or replaces a user-visible document.
  const bytes = await readChatMedia(file, conversationId);
  const locations = await new picker.DocumentViewPicker(context).save({ newFileNames: [(file.name || 'attachment').replace(/[\\/]/g, '_')] });
  if (!locations.length) return;
  const destination = await fs.open(locations[0], fs.OpenMode.WRITE_ONLY | fs.OpenMode.TRUNC);
  try { if (await fs.write(destination.fd, bytes) !== bytes.byteLength) throw new Error('INCOMPLETE_FILE_WRITE'); }
  finally { await fs.close(destination); }
}
