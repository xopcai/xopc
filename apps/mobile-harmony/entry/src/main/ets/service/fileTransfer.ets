import { http } from '@kit.NetworkKit';
import { fileIo as fs, picker, fileUri } from '@kit.CoreFileKit';
import { common } from '@kit.AbilityKit';
import { gatewaySession } from './gatewaySession';
import { XopcHttpError } from './transport';
import { XopcFile, XopcFileResult } from '../model/files';

interface XopcTransferHeaders { Authorization: string; 'Content-Type'?: string; }

export class XopcFileTransfer {
  async upload(context: common.Context, spaceId: string, directory: string): Promise<XopcFile | undefined> {
    const options = new picker.DocumentSelectOptions(); options.maxSelectNumber = 1;
    const uris = await new picker.DocumentViewPicker(context).select(options);
    if (!uris.length) return undefined;
    const uri = uris[0]; const name = new fileUri.FileUri(uri).name;
    const file = await fs.open(uri, fs.OpenMode.READ_ONLY);
    let data: ArrayBuffer;
    try {
      const stat = await fs.stat(file.fd);
      if (stat.size > 8 * 1024 * 1024) throw new Error('UPLOAD_LIMIT_8_MB');
      data = new ArrayBuffer(stat.size);
      const read = await fs.read(file.fd, data);
      if (read !== stat.size) throw new Error('INCOMPLETE_FILE_READ');
    } finally { await fs.close(file); }
    const auth = await gatewaySession.transferAuth();
    const request = http.createHttp();
    const headers: XopcTransferHeaders = { Authorization: 'Bearer ' + auth.token, 'Content-Type': 'multipart/form-data' };
    const optionsHttp: http.HttpRequestOptions = {
      method: http.RequestMethod.POST, header: headers, maxRedirects: 0, connectTimeout: 8000, readTimeout: 60000,
      expectDataType: http.HttpDataType.STRING, usingCache: false,
      multiFormDataList: [
        { name: 'directory', contentType: 'text/plain', data: directory },
        { name: 'file', contentType: 'application/octet-stream', remoteFileName: name, data }
      ]
    };
    try {
      const response = await request.request(auth.origin + '/api/files/spaces/' + encodeURIComponent(spaceId) + '/upload', optionsHttp);
      if (response.responseCode !== 201) throw new XopcHttpError(response.responseCode);
      const result = JSON.parse(response.result as string) as XopcFileResult;
      if (!result.resource?.id) throw new Error('INVALID_UPLOAD');
      return result.resource;
    } finally { request.destroy(); }
  }

  async download(context: common.Context, file: XopcFile): Promise<void> {
    if (file.size > 16 * 1024 * 1024) throw new Error('DOWNLOAD_LIMIT_16_MB');
    const auth = await gatewaySession.transferAuth();
    const request = http.createHttp();
    let data: ArrayBuffer;
    try {
      const headers: XopcTransferHeaders = { Authorization: 'Bearer ' + auth.token };
      const options: http.HttpRequestOptions = { method: http.RequestMethod.GET, header: headers,
        expectDataType: http.HttpDataType.ARRAY_BUFFER, maxLimit: 16 * 1024 * 1024,
        maxRedirects: 0, connectTimeout: 8000, readTimeout: 60000, usingCache: false };
      const response = await request.request(auth.origin + '/api/files/' + encodeURIComponent(file.id) + '/content', options);
      if (response.responseCode !== 200) throw new XopcHttpError(response.responseCode);
      data = response.result as ArrayBuffer;
      if (data.byteLength !== file.size) throw new Error('FILE_CHANGED_REFRESH_FIRST');
    } finally { request.destroy(); }
    const options = new picker.DocumentSaveOptions(); options.newFileNames = [file.name.replace(/[\\/]/g, '_')];
    const uris = await new picker.DocumentViewPicker(context).save(options);
    if (!uris.length) return;
    const destination = await fs.open(uris[0], fs.OpenMode.WRITE_ONLY | fs.OpenMode.TRUNC);
    try {
      if (await fs.write(destination.fd, data) !== data.byteLength) throw new Error('INCOMPLETE_FILE_WRITE');
    } finally { await fs.close(destination); }
  }
}
