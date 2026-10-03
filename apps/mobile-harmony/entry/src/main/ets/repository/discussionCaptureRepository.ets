import { http } from '@kit.NetworkKit';
import { cryptoFramework } from '@kit.CryptoArchitectureKit';
import { gatewaySession } from '../service/gatewaySession';
import { XopcHttpError } from '../service/transport';
import {
  XopcDiscussionCaptureSettings, XopcDiscussionDetail, XopcDiscussionRecordingManifest,
  XopcDiscussionTranscript
} from '../model/discussionCapture';

interface XopcDiscussionHeaders {
  Authorization: string;
  'Content-Type': string;
  'x-audio-sha256'?: string;
}

interface XopcCreateDiscussionBody {
  clientRequestId: string;
  consentPolicyVersion: number;
  source: 'mobile';
  recordedAt: number;
}

export class XopcDiscussionCaptureRepository {
  async settings(): Promise<XopcDiscussionCaptureSettings> {
    return JSON.parse(await gatewaySession.request('/api/discussion-capture/settings')) as XopcDiscussionCaptureSettings;
  }

  async acknowledge(consentPolicyVersion: number): Promise<void> {
    await gatewaySession.request('/api/discussion-capture/settings', 'PUT', JSON.stringify({ consentPolicyVersion }));
  }

  async create(clientRequestId: string, consentPolicyVersion: number): Promise<XopcDiscussionDetail> {
    const body: XopcCreateDiscussionBody = { clientRequestId, consentPolicyVersion, source: 'mobile', recordedAt: Date.now() };
    return JSON.parse(await gatewaySession.request('/api/discussions', 'POST', JSON.stringify(body), clientRequestId)) as XopcDiscussionDetail;
  }

  async transcript(id: string): Promise<XopcDiscussionTranscript> {
    return JSON.parse(await gatewaySession.request('/api/discussions/' + encodeURIComponent(id) + '/transcript')) as XopcDiscussionTranscript;
  }

  async upload(id: string, sequence: number, wav: Uint8Array, startedAtMs: number,
    endedAtMs: number): Promise<XopcDiscussionTranscript> {
    const sha256 = await xopcSha256(wav);
    const revision = gatewaySession.connectionRevision();
    const auth = await gatewaySession.transferAuth();
    gatewaySession.assertConnection(revision);
    const request = http.createHttp();
    const data = wav.buffer.slice(wav.byteOffset, wav.byteOffset + wav.byteLength);
    const headers: XopcDiscussionHeaders = { Authorization: 'Bearer ' + auth.token, 'Content-Type': 'application/octet-stream',
      'x-audio-sha256': sha256 };
    try {
      const recording = await request.request(auth.origin + '/api/discussions/' + encodeURIComponent(id) +
        '/recording/chunks/' + sequence, { method: http.RequestMethod.PUT, header: headers, extraData: data,
        expectDataType: http.HttpDataType.STRING, maxRedirects: 0, connectTimeout: 8000, readTimeout: 60000, usingCache: false });
      gatewaySession.assertConnection(revision);
      if (recording.responseCode !== 201) throw new XopcHttpError(recording.responseCode);
      const multipartHeaders: XopcDiscussionHeaders = { Authorization: 'Bearer ' + auth.token, 'Content-Type': 'multipart/form-data' };
      const segment = await request.request(auth.origin + '/api/discussions/' + encodeURIComponent(id) + '/segments/' + sequence, {
        method: http.RequestMethod.PUT, header: multipartHeaders, expectDataType: http.HttpDataType.STRING,
        multiFormDataList: [
          { name: 'file', contentType: 'audio/wav', remoteFileName: 'segment-' + sequence + '.wav', data },
          { name: 'startedAtMs', contentType: 'text/plain', data: startedAtMs.toString() },
          { name: 'endedAtMs', contentType: 'text/plain', data: endedAtMs.toString() },
          { name: 'sha256', contentType: 'text/plain', data: sha256 }
        ], maxRedirects: 0, connectTimeout: 8000, readTimeout: 60000, usingCache: false
      });
      gatewaySession.assertConnection(revision);
      if (segment.responseCode !== 201) throw new XopcHttpError(segment.responseCode);
      return JSON.parse(segment.result as string) as XopcDiscussionTranscript;
    } finally { request.destroy(); }
  }

  async seal(id: string, manifest: XopcDiscussionRecordingManifest): Promise<void> {
    await gatewaySession.request('/api/discussions/' + encodeURIComponent(id) + '/capture/seal', 'POST', JSON.stringify(manifest));
  }

  async cancel(id: string): Promise<void> {
    await gatewaySession.request('/api/discussions/' + encodeURIComponent(id) + '/cancel', 'POST');
  }
}

async function xopcSha256(bytes: Uint8Array): Promise<string> {
  const digest = cryptoFramework.createMd('SHA256');
  await digest.update({ data: bytes });
  const result = (await digest.digest()).data;
  let value = '';
  result.forEach((byte: number): void => { value += byte.toString(16).padStart(2, '0'); });
  return value;
}
