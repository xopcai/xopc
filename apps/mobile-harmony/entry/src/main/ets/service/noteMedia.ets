import { common } from '@kit.AbilityKit';
import { util } from '@kit.ArkTS';
import { http } from '@kit.NetworkKit';
import { fileIo as fs } from '@kit.CoreFileKit';
import { XopcChatAttachment } from '../model/chat';
import { XopcNoteAttachment } from '../model/note';
import { pickChatAttachment } from './chatAttachmentPicker';
import { pickChatPhoto } from './chatPhotoPicker';
import { gatewaySession } from './gatewaySession';
import { XopcHttpError } from './transport';

interface XopcNoteMediaHeaders { Authorization: string; 'Content-Type': string; 'Idempotency-Key': string; }
interface XopcNoteMediaResult { attachment?: XopcNoteAttachment; }

/** Native picker and multipart uploader for note attachments. */
export class XopcNoteMediaService {
  async pickFile(context: common.Context): Promise<XopcChatAttachment | undefined> {
    return pickChatAttachment(context, []);
  }

  async pickPhoto(context: common.Context, takePhoto: boolean): Promise<XopcChatAttachment | undefined> {
    return pickChatPhoto(context, [], takePhoto);
  }

  async upload(noteId: string, attachment: XopcChatAttachment, mutationId: string): Promise<XopcNoteAttachment> {
    const bytes = new util.Base64Helper().decodeSync(attachment.data);
    const data = new ArrayBuffer(bytes.byteLength);
    new Uint8Array(data).set(bytes);
    return this.uploadBytes(noteId, attachment.name, attachment.mimeType, data, mutationId, attachment.duration);
  }

  async uploadFile(noteId: string, path: string, name: string, mimeType: string, mutationId: string): Promise<XopcNoteAttachment> {
    const file = await fs.open(path, fs.OpenMode.READ_ONLY);
    let data: ArrayBuffer;
    try {
      const size = (await fs.stat(file.fd)).size;
      if (size <= 0 || size > 8 * 1024 * 1024) throw new Error('UPLOAD_LIMIT_8_MB');
      data = new ArrayBuffer(size);
      if (await fs.read(file.fd, data) !== size) throw new Error('INCOMPLETE_FILE_READ');
    } finally { await fs.close(file); }
    return this.uploadBytes(noteId, name, mimeType, data, mutationId);
  }

  private async uploadBytes(noteId: string, name: string, mimeType: string, data: ArrayBuffer,
    mutationId: string, duration?: number): Promise<XopcNoteAttachment> {
    const auth = await gatewaySession.transferAuth();
    const request = http.createHttp();
    const headers: XopcNoteMediaHeaders = {
      Authorization: 'Bearer ' + auth.token,
      'Content-Type': 'multipart/form-data',
      'Idempotency-Key': mutationId
    };
    const parts: http.MultiFormData[] = [{
      name: 'file',
      contentType: mimeType,
      remoteFileName: name,
      data
    }];
    if (duration !== undefined && duration > 0) parts.push({ name: 'duration', contentType: 'text/plain', data: Math.ceil(duration).toString() });
    const options: http.HttpRequestOptions = {
      method: http.RequestMethod.POST,
      header: headers,
      maxRedirects: 0,
      connectTimeout: 8000,
      readTimeout: 60000,
      expectDataType: http.HttpDataType.STRING,
      usingCache: false,
      multiFormDataList: parts
    };
    try {
      const path = '/api/notes/' + encodeURIComponent(noteId) + '/media';
      const response = await request.request(auth.origin + path, options);
      if (response.responseCode !== 201) throw new XopcHttpError(response.responseCode);
      const result = JSON.parse(response.result as string) as XopcNoteMediaResult;
      if (!result.attachment?.id) throw new Error('INVALID_NOTE_ATTACHMENT_UPLOAD');
      return result.attachment;
    } finally { request.destroy(); }
  }
}
