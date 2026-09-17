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

export async function readChatMedia(file: XopcHistoryMedia, conversationId: string): Promise<ArrayBuffer> {
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
