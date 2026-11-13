import { http } from '@kit.NetworkKit';
import { fileIo as fs } from '@kit.CoreFileKit';
import { XopcGeneratedMediaKind } from '../model/generatedMedia';
import { generatedMediaPath } from '../common/generatedMedia';
import { gatewaySession } from './gatewaySession';
import { signedHttpRequest } from './requestProof';
import { XopcHttpError } from './transport';

interface XopcGeneratedMediaHeaders { Authorization: string; Range: string; }
const CHUNK_SIZE: number = 2 * 1024 * 1024;
const FILE_LIMIT: number = 256 * 1024 * 1024;

export async function removeGeneratedMediaFile(path: string): Promise<void> {
  if (path) { try { await fs.unlink(path); } catch (_) {} }
}

export async function downloadGeneratedMedia(kind: XopcGeneratedMediaKind, conversationId: string, id: string,
  destination: string, isCurrent: () => boolean): Promise<number> {
  const revision = gatewaySession.connectionRevision();
  const path = generatedMediaPath(kind, conversationId) + '/' + encodeURIComponent(id) + (kind === 'music' ? '/audio' : '/video');
  const output = await fs.open(destination, fs.OpenMode.CREATE | fs.OpenMode.WRITE_ONLY | fs.OpenMode.TRUNC);
  let offset = 0;
  let expected = 0;
  let complete = false;
  try {
    do {
      if (!isCurrent()) throw new Error('MEDIA_TRANSFER_CANCELLED');
      const auth = await gatewaySession.transferAuth();
      gatewaySession.assertConnection(revision);
      const headers: XopcGeneratedMediaHeaders = { Authorization: 'Bearer ' + auth.token,
        Range: 'bytes=' + offset + '-' + (offset + CHUNK_SIZE - 1) };
      const request = http.createHttp();
      try {
        const response = await signedHttpRequest(request, auth.origin + path, { method: http.RequestMethod.GET,
          header: headers, expectDataType: http.HttpDataType.ARRAY_BUFFER, maxRedirects: 0, maxLimit: CHUNK_SIZE,
          connectTimeout: 8000, readTimeout: 30000, usingCache: false });
        gatewaySession.assertConnection(revision);
        if (!isCurrent()) throw new Error('MEDIA_TRANSFER_CANCELLED');
        if (response.responseCode !== 206) throw new XopcHttpError(response.responseCode);
        const rawHeaders = response.header;
        const responseHeaders = (typeof rawHeaders === 'string' ? JSON.parse(rawHeaders) : rawHeaders) as Record<string, string>;
        const rangeKey = Object.keys(responseHeaders).find((key: string): boolean => key.toLowerCase() === 'content-range');
        const range = /^bytes (\d+)-(\d+)\/(\d+)$/.exec(rangeKey ? responseHeaders[rangeKey] : '');
        const bytes = response.result;
        if (!range || !(bytes instanceof ArrayBuffer)) throw new Error('INVALID_MEDIA_RANGE');
        const total = Number(range[3]);
        const length = bytes.byteLength;
        if (Number(range[1]) !== offset || Number(range[2]) !== offset + length - 1
          || !length || length > CHUNK_SIZE || total > FILE_LIMIT || offset + length > total
          || (expected !== 0 && total !== expected)) throw new Error('INVALID_MEDIA_RANGE');
        expected = total;
        if (await fs.write(output.fd, bytes) !== length) throw new Error('INCOMPLETE_FILE_WRITE');
        offset += length;
      } finally { request.destroy(); }
    } while (offset < expected);
    complete = true;
    return offset;
  } finally {
    try { await fs.close(output); }
    finally { if (!complete) await removeGeneratedMediaFile(destination); }
  }
}
