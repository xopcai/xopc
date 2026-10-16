import { XopcDiscussionReview } from '../model/discussionCapture';
import { XopcDiscussionAnnotation, XopcAnnotationInput, XopcResolvedAnnotation, XopcDiscussionEvidence } from '../model/discussionCapture';
import { signedHttpRequest } from '../service/requestProof';
import { http } from '@kit.NetworkKit';
import { cryptoFramework } from '@kit.CryptoArchitectureKit';
import { gatewaySession } from '../service/gatewaySession';
import { XopcHttpError } from '../service/transport';
import {
  XopcDiscussionCaptureSettings, XopcDiscussionDetail, XopcDiscussionRecordingManifest,
  XopcDiscussionTranscript
} from '../model/discussionCapture';

interface XopcRecordingChunkReceipt { sequence: number; sha256: string; bytes: number; }

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
  async review(id: string,query: string = '',offset: number = 0,version: string = ''): Promise<XopcDiscussionReview> {
    return JSON.parse(await gatewaySession.request('/api/discussions/' + encodeURIComponent(id) + '/review?q=' + encodeURIComponent(query) + '&offset=' + offset + (version ? '&version=' + version : ''))) as XopcDiscussionReview;
  }
  async annotations(id: string): Promise<XopcResolvedAnnotation[]> {
    return JSON.parse(await gatewaySession.request('/api/discussions/' + encodeURIComponent(id) + '/annotations')) as XopcResolvedAnnotation[];
  }
  async saveAnnotation(id: string,input: XopcAnnotationInput): Promise<XopcDiscussionAnnotation> {
    return JSON.parse(await gatewaySession.request('/api/discussions/' + encodeURIComponent(id) + '/annotations/' + encodeURIComponent(input.id),'PUT',JSON.stringify(input))) as XopcDiscussionAnnotation;
  }
  async evidence(id: string,revision: number,sequences: number[]): Promise<XopcDiscussionEvidence> {
    return JSON.parse(await gatewaySession.request('/api/discussions/' + encodeURIComponent(id) + '/evidence?revision=' + revision + '&segments=' + sequences.join(','))) as XopcDiscussionEvidence;
  }
  async audioClip(id: string,startMs: number,endMs: number): Promise<ArrayBuffer> {
    const revision = gatewaySession.connectionRevision(); const auth = await gatewaySession.transferAuth(); gatewaySession.assertConnection(revision);
    const request = http.createHttp();
    try {
      const headers: XopcDiscussionHeaders = { Authorization: 'Bearer ' + auth.token, 'Content-Type': 'application/octet-stream' };
      const result = await signedHttpRequest(request,auth.origin + '/api/discussions/' + encodeURIComponent(id) + '/audio-clip?startMs=' + startMs + '&endMs=' + endMs,
        { method: http.RequestMethod.GET, header: headers, expectDataType: http.HttpDataType.ARRAY_BUFFER, maxLimit: 4 * 1024 * 1024, maxRedirects: 0, connectTimeout: 8000, readTimeout: 35000, usingCache: false });
      gatewaySession.assertConnection(revision);
      if (result.responseCode !== 200) throw new XopcHttpError(result.responseCode);
      return result.result as ArrayBuffer;
    } finally { request.destroy(); }
  }

  async settings(): Promise<XopcDiscussionCaptureSettings> {
    return JSON.parse(await gatewaySession.request('/api/discussion-capture/settings')) as XopcDiscussionCaptureSettings;
  }

  async acknowledge(consentPolicyVersion: number): Promise<void> {
    await gatewaySession.request('/api/discussion-capture/settings', 'PUT', JSON.stringify({ consentPolicyVersion }));
  }

  async create(clientRequestId: string, consentPolicyVersion: number, recordedAt: number = Date.now()): Promise<XopcDiscussionDetail> {
    const body: XopcCreateDiscussionBody = { clientRequestId, consentPolicyVersion, source: 'mobile', recordedAt };
    return JSON.parse(await gatewaySession.request('/api/discussions', 'POST', JSON.stringify(body), clientRequestId)) as XopcDiscussionDetail;
  }

  async transcript(id: string): Promise<XopcDiscussionTranscript> {
    return JSON.parse(await gatewaySession.request('/api/discussions/' + encodeURIComponent(id) + '/transcript')) as XopcDiscussionTranscript;
  }

  async byNote(noteId: string): Promise<XopcDiscussionDetail> {
    return JSON.parse(await gatewaySession.request('/api/discussions/by-note/' + encodeURIComponent(noteId))) as XopcDiscussionDetail;
  }

  async organize(id: string, template: string = 'general'): Promise<void> {
    await gatewaySession.request('/api/discussions/' + encodeURIComponent(id) + '/organize', 'POST', JSON.stringify({ template: template }));
  }

  async retry(id: string, fromAudio: boolean = false): Promise<void> {
    await gatewaySession.request('/api/discussions/' + encodeURIComponent(id) + '/retry', 'POST', JSON.stringify({ mode: fromAudio ? 'from_audio' : 'resume' }));
  }

  async recordingSequences(id: string): Promise<number[]> {
    const chunks = JSON.parse(await gatewaySession.request('/api/discussions/' + encodeURIComponent(id) + '/recording/chunks')) as XopcRecordingChunkReceipt[];
    return chunks.map((chunk: XopcRecordingChunkReceipt): number => chunk.sequence);
  }

  async uploadOriginal(id: string, sequence: number, wav: Uint8Array): Promise<void> {
    const sha256 = await xopcSha256(wav);
    const revision = gatewaySession.connectionRevision();
    const auth = await gatewaySession.transferAuth();
    gatewaySession.assertConnection(revision);
    const request = http.createHttp();
    const headers: XopcDiscussionHeaders = { Authorization: 'Bearer ' + auth.token, 'Content-Type': 'application/octet-stream',
      'x-audio-sha256': sha256 };
    try {
      const recording = await signedHttpRequest(request, auth.origin + '/api/discussions/' + encodeURIComponent(id) +
        '/recording/chunks/' + sequence, { method: http.RequestMethod.PUT, header: headers,
        extraData: wav.buffer.slice(wav.byteOffset, wav.byteOffset + wav.byteLength),
        expectDataType: http.HttpDataType.STRING, maxRedirects: 0, connectTimeout: 8000, readTimeout: 60000, usingCache: false });
      gatewaySession.assertConnection(revision);
      if (recording.responseCode !== 201) throw new XopcHttpError(recording.responseCode);
    } finally { request.destroy(); }
  }

  async uploadTranscript(id: string, sequence: number, wav: Uint8Array, startedAtMs: number,
    endedAtMs: number): Promise<XopcDiscussionTranscript> {
    const sha256 = await xopcSha256(wav);
    const revision = gatewaySession.connectionRevision();
    const auth = await gatewaySession.transferAuth();
    gatewaySession.assertConnection(revision);
    const request = http.createHttp();
    const data = wav.buffer.slice(wav.byteOffset, wav.byteOffset + wav.byteLength);
    const headers: XopcDiscussionHeaders = { Authorization: 'Bearer ' + auth.token, 'Content-Type': 'multipart/form-data' };
    try {
      const segment = await signedHttpRequest(request, auth.origin + '/api/discussions/' + encodeURIComponent(id) + '/segments/' + sequence, {
        method: http.RequestMethod.PUT, header: headers, expectDataType: http.HttpDataType.STRING,
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
