import { http } from '@kit.NetworkKit';
import { common, Want, wantConstant } from '@kit.AbilityKit';
import { fileIo as fs, fileUri, picker } from '@kit.CoreFileKit';
import { util } from '@kit.ArkTS';
import { gatewaySession } from './gatewaySession';
import { XopcChatAttachment, XopcHistoryMedia } from '../model/chat';
import { XopcHttpError } from './transport';
import { CHAT_MEDIA_LIMIT, chatMediaSource } from '../common/chatMediaSource';
import { normalizedFileMimeType } from '../common/filePreview';
import { XopcFileSpaceResult, XopcFileResult } from '../model/files';

interface XopcChatMediaHeaders { Authorization: string; }
interface XopcChatFileResolve { spaceId: string; path: string; }
interface XopcMediaCacheEntry { bytes: ArrayBuffer; expires: number; }
const mediaCache = new Map<string, XopcMediaCacheEntry>();
const mediaPending = new Map<string, Promise<ArrayBuffer>>();
let mediaCacheRevision: number = -1;
let mediaCacheGeneration: number = 0;
let mediaCacheSize: number = 0;
const CHAT_MEDIA_DISK_DIRECTORY: string = 'xopc-chat-media';
const CHAT_MEDIA_DISK_FILE_LIMIT: number = 4 * 1024 * 1024;

export function clearChatMediaCache(): void {
  mediaCache.clear(); mediaPending.clear(); mediaCacheSize = 0; mediaCacheGeneration++;
}

function chatMediaIdentity(file: XopcHistoryMedia, conversationId: string): string {
  const gatewayId = gatewaySession.currentProfile()?.gatewayId || '';
  const sourceIdentity = [file.uri, file.workspaceRelativePath || '', file.name, file.mimeType, file.size.toString()].join(':');
  return [gatewayId, conversationId, sourceIdentity].join(':');
}

function chatMediaHash(source: string): string {
  let first = 2166136261;
  let second = 2246822519;
  for (let index = 0; index < source.length; index++) {
    const code = source.charCodeAt(index);
    first = Math.imul(first ^ code, 16777619);
    second = Math.imul(second ^ code, 3266489917);
  }
  return (first >>> 0).toString(16).padStart(8, '0') + (second >>> 0).toString(16).padStart(8, '0');
}

function chatMediaCachePath(context: common.Context | undefined, file: XopcHistoryMedia, conversationId: string): string {
  // Managed documents are mutable; attachment caches must never hide a saved revision.
  if (file.uri.startsWith('xopc-file:') || file.workspaceRelativePath) return '';
  if (!context?.cacheDir || file.size <= 0 || file.size > CHAT_MEDIA_DISK_FILE_LIMIT) return '';
  const extension = file.mimeType.startsWith('audio/') ? '.audio' : '.media';
  return context.cacheDir + '/' + CHAT_MEDIA_DISK_DIRECTORY + '/' + chatMediaHash(chatMediaIdentity(file, conversationId)) + extension;
}

async function readChatMediaDiskCache(context: common.Context | undefined, file: XopcHistoryMedia,
  conversationId: string): Promise<ArrayBuffer | undefined> {
  const path = chatMediaCachePath(context, file, conversationId);
  if (!path) return undefined;
  let input: fs.File | undefined = undefined;
  try {
    input = await fs.open(path, fs.OpenMode.READ_ONLY);
    const size = (await fs.stat(input.fd)).size;
    if (size !== file.size || size <= 0 || size > CHAT_MEDIA_DISK_FILE_LIMIT) throw new Error('INVALID_CACHED_MEDIA');
    const bytes = new ArrayBuffer(size);
    if (await fs.read(input.fd, bytes) !== size) throw new Error('INCOMPLETE_CACHED_MEDIA');
    return bytes;
  } catch (_error) {
    try { await fs.unlink(path); } catch (_) {}
    return undefined;
  } finally { if (input) { try { await fs.close(input); } catch (_) {} } }
}

async function writeChatMediaDiskCache(context: common.Context | undefined, file: XopcHistoryMedia,
  conversationId: string, bytes: ArrayBuffer): Promise<void> {
  const path = chatMediaCachePath(context, file, conversationId);
  const cacheDir = context?.cacheDir || '';
  if (!path || !cacheDir || bytes.byteLength !== file.size) return;
  const directory = cacheDir + '/' + CHAT_MEDIA_DISK_DIRECTORY;
  try { await fs.mkdir(directory, true); } catch (_) {}
  let output: fs.File | undefined = undefined;
  try {
    output = await fs.open(path, fs.OpenMode.CREATE | fs.OpenMode.WRITE_ONLY | fs.OpenMode.TRUNC);
    if (await fs.write(output.fd, bytes) !== bytes.byteLength) throw new Error('INCOMPLETE_MEDIA_CACHE_WRITE');
  } catch (_error) {
    try { await fs.unlink(path); } catch (_) {}
  } finally { if (output) { try { await fs.close(output); } catch (_) {} } }
}

export async function seedChatMediaCache(context: common.Context, attachment: XopcChatAttachment,
  conversationId: string): Promise<void> {
  if (!attachment.data || !attachment.mimeType.startsWith('audio/')) return;
  const encoded = attachment.data.startsWith('data:') ? attachment.data.split('base64,').pop() || '' : attachment.data;
  if (!encoded) return;
  const decoded = new util.Base64Helper().decodeSync(encoded);
  const file: XopcHistoryMedia = { id: '', name: attachment.name, type: attachment.type, mimeType: attachment.mimeType,
    size: attachment.size, uri: '' };
  await writeChatMediaDiskCache(context, file, conversationId, decoded.buffer.slice(decoded.byteOffset, decoded.byteOffset + decoded.byteLength));
}

export async function readChatMedia(file: XopcHistoryMedia, conversationId: string,
  context?: common.Context): Promise<ArrayBuffer> {
  if (file.size > CHAT_MEDIA_LIMIT) throw new Error('INVALID_MEDIA_OR_TOO_LARGE');
  const revision = gatewaySession.connectionRevision();
  gatewaySession.assertConnection(revision);
  if (mediaCacheRevision !== revision) { clearChatMediaCache(); mediaCacheRevision = revision; }
  if (file.uri.startsWith('xopc-file:') || file.workspaceRelativePath) return fetchChatMedia(file, conversationId);
  // Embedded payloads already live in message memory. Do not retain another copy.
  if (file.uri.startsWith('data:')) {
    const embedded = await fetchChatMedia(file, conversationId);
    await writeChatMediaDiskCache(context, file, conversationId, embedded);
    return embedded;
  }
  const key = chatMediaIdentity(file, conversationId);
  const cached = mediaCache.get(key);
  if (cached && cached.expires > Date.now()) { mediaCache.delete(key); mediaCache.set(key, cached); return cached.bytes.slice(0); }
  if (cached) { mediaCacheSize -= cached.bytes.byteLength; mediaCache.delete(key); }
  const disk = await readChatMediaDiskCache(context, file, conversationId);
  if (disk) return disk;
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
        mediaCache.set(key, { bytes, expires: Date.now() + 5 * 60 * 1000 }); mediaCacheSize += bytes.byteLength;
      }
      writeChatMediaDiskCache(context, file, conversationId, bytes).catch((_error: Error): void => {});
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
    if (!source.external) gatewaySession.assertConnection(revision);
    if (result.responseCode !== 200) throw new XopcHttpError(result.responseCode);
    const bytes = result.result;
    if (!(bytes instanceof ArrayBuffer) || bytes.byteLength > CHAT_MEDIA_LIMIT) throw new Error('INVALID_MEDIA_OR_TOO_LARGE');
    return bytes;
  } finally { request.destroy(); }
}

export async function saveChatMedia(context: common.Context, file: XopcHistoryMedia, conversationId: string): Promise<void> {
  // Fetch successfully before the picker creates or replaces a user-visible document.
  const bytes = await readChatMedia(file, conversationId, context);
  const locations = await new picker.DocumentViewPicker(context).save({ newFileNames: [(file.name || 'attachment').replace(/[\\/]/g, '_')] });
  if (!locations.length) return;
  const destination = await fs.open(locations[0], fs.OpenMode.WRITE_ONLY | fs.OpenMode.TRUNC);
  try { if (await fs.write(destination.fd, bytes) !== bytes.byteLength) throw new Error('INCOMPLETE_FILE_WRITE'); }
  finally { await fs.close(destination); }
}

function chatMediaOpenName(file: XopcHistoryMedia): string {
  return (file.name || 'attachment').replace(/[\\/:*?"<>|]/g, '_').slice(-120);
}

export async function openChatMedia(context: common.UIAbilityContext, file: XopcHistoryMedia, conversationId: string): Promise<void> {
  const bytes = await readChatMedia(file, conversationId, context);
  const directory = context.cacheDir + '/xopc-open-files/' + chatMediaHash(chatMediaIdentity(file, conversationId));
  await fs.mkdir(directory, true);
  const path = directory + '/' + chatMediaOpenName(file);
  let output: fs.File | undefined = undefined;
  try {
    output = await fs.open(path, fs.OpenMode.CREATE | fs.OpenMode.WRITE_ONLY | fs.OpenMode.TRUNC);
    if (await fs.write(output.fd, bytes) !== bytes.byteLength) throw new Error('INCOMPLETE_FILE_WRITE');
  } catch (error) {
    try { await fs.unlink(path); } catch (_) {}
    throw error as Error;
  } finally { if (output) await fs.close(output); }
  const uri = fileUri.getUriFromPath(path);
  const want: Want = { action: 'ohos.want.action.viewData', uri, type: normalizedFileMimeType(file.name, file.mimeType),
    flags: wantConstant.Flags.FLAG_AUTH_READ_URI_PERMISSION };
  try { await context.startAbility(want); }
  catch (error) { try { await fs.unlink(path); } catch (_) {} throw error as Error; }
}
