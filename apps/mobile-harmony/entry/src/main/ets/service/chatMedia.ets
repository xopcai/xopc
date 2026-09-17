import { http } from '@kit.NetworkKit';
import { common } from '@kit.AbilityKit';
import { fileIo as fs, picker } from '@kit.CoreFileKit';
import { gatewaySession } from './gatewaySession';
import { XopcHistoryMedia } from '../model/chat';
import { XopcHttpError } from './transport';

interface XopcChatMediaHeaders { Authorization: string; }

export async function readChatMedia(file: XopcHistoryMedia, conversationId: string): Promise<ArrayBuffer> {
  if (!conversationId || !file.uri || file.size > 10 * 1024 * 1024) throw new Error('INVALID_MEDIA_OR_TOO_LARGE');
  const auth = await gatewaySession.transferAuth();
  const request = http.createHttp();
  const headers: XopcChatMediaHeaders = { Authorization: 'Bearer ' + auth.token };
  try {
    // Never attach the gateway token to a URL supplied in a transcript.
    const result = await request.request(auth.origin + '/api/media/read?uri=' + encodeURIComponent(file.uri)
      + '&conversationId=' + encodeURIComponent(conversationId), { method: http.RequestMethod.GET, header: headers,
      expectDataType: http.HttpDataType.ARRAY_BUFFER, maxRedirects: 0, maxLimit: 10 * 1024 * 1024,
      connectTimeout: 8000, readTimeout: 30000, usingCache: false });
    if (result.responseCode !== 200) throw new XopcHttpError(result.responseCode);
    return result.result as ArrayBuffer;
  } finally { request.destroy(); }
}

export async function saveChatMedia(context: common.Context, file: XopcHistoryMedia, conversationId: string): Promise<void> {
  const locations = await new picker.DocumentViewPicker(context).save({ newFileNames: [(file.name || 'attachment').replace(/[\\/]/g, '_')] });
  if (!locations.length) return;
  const bytes = await readChatMedia(file, conversationId);
  const destination = await fs.open(locations[0], fs.OpenMode.WRITE_ONLY | fs.OpenMode.TRUNC);
  try { if (await fs.write(destination.fd, bytes) !== bytes.byteLength) throw new Error('INCOMPLETE_FILE_WRITE'); }
  finally { await fs.close(destination); }
}
