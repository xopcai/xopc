import { http } from '@kit.NetworkKit';
import { secureOrigin } from '../common/protocol';

interface XopcHttpHeaders { 'Content-Type': string; 'Authorization': string; }

export class XopcHttpError extends Error {
  status: number;
  body: string;
  constructor(status: number, body: string = '') {
    super('HTTP_' + status);
    this.status = status;
    this.body = body;
  }
}

export class XopcTransport {
  async request(origin: string, path: string, method: string = 'GET', body: string = '', token: string = ''): Promise<string> {
    if (!path.startsWith('/api/') || path.includes('#')) throw new Error('INVALID_API_PATH');
    const connection = http.createHttp();
    const headers: XopcHttpHeaders = { 'Content-Type': 'application/json', 'Authorization': token ? 'Bearer ' + token : '' };
    const options: http.HttpRequestOptions = {
      method: http.RequestMethod.GET, customMethod: method, header: headers,
      expectDataType: http.HttpDataType.STRING, connectTimeout: 8000, readTimeout: 30000,
      maxRedirects: 0, usingCache: false, maxLimit: 5 * 1024 * 1024
    };
    if (body) options.extraData = body;
    try {
      const response = await connection.request(secureOrigin(origin) + path, options);
      if (response.responseCode < 200 || response.responseCode >= 300) {
        throw new XopcHttpError(response.responseCode, typeof response.result === 'string' ? response.result : '');
      }
      if (typeof response.result !== 'string') throw new Error('INVALID_HTTP_RESPONSE');
      return response.result;
    } finally { connection.destroy(); }
  }
}
