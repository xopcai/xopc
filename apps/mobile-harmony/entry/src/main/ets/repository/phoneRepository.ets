import { http } from '@kit.NetworkKit';
import { XopcDeviceCrypto } from '../service/deviceCrypto';
import { gatewaySession } from '../service/gatewaySession';
import { signedHttpRequest } from '../service/requestProof';
import { XopcHttpError } from '../service/transport';
import { XopcPhoneBinding, XopcPhoneSummary, XopcPhoneLiveState, XopcPhoneEnvelope, XopcPhoneCompatibility,
  XopcPhoneControlRequest, XopcPhoneAction, XopcPhoneFrame, XopcPhoneFrameHeaders, XopcPhoneTicketRequest, XopcPhoneTicket } from '../model/phone';

interface XopcPhoneHttpHeaders { Authorization: string; }
export class XopcPhoneRepository {
  readonly clientId: string = new XopcDeviceCrypto().uuid();
  private crypto: XopcDeviceCrypto = new XopcDeviceCrypto();
  base(id: string): string { return '/api/phone/conversations/' + encodeURIComponent(id); }
  async supported(): Promise<boolean> {
    const result = JSON.parse(await gatewaySession.request('/api/endpoint-tools/compatibility')) as XopcPhoneEnvelope<XopcPhoneCompatibility>;
    return result.payload?.mobilePhoneWorkspaceV1 === true;
  }
  async summary(id: string): Promise<XopcPhoneSummary> {
    const result = JSON.parse(await gatewaySession.request(this.base(id) + '/summary')) as XopcPhoneEnvelope<XopcPhoneSummary>;
    if (!result.ok || !result.payload || typeof result.payload.available !== 'boolean') throw new Error('INVALID_PHONE_RESPONSE');
    return result.payload;
  }
  async state(id: string): Promise<XopcPhoneLiveState | null> {
    const result = JSON.parse(await gatewaySession.request(this.base(id) + '?clientId=' + this.clientId)) as XopcPhoneEnvelope<XopcPhoneLiveState | null>;
    if (!result.ok) throw new Error('INVALID_PHONE_RESPONSE');
    return result.payload;
  }
  async control(binding: XopcPhoneBinding, state: XopcPhoneLiveState, op: string, action?: XopcPhoneAction,
    frameSeq?: number, geometry?: number): Promise<XopcPhoneLiveState> {
    const body: XopcPhoneControlRequest = { clientId: this.clientId, assistanceId: state.report.assistanceId,
      operationId: this.crypto.uuid(), epoch: state.report.controlEpoch, expectedTranscriptId: binding.transcriptId,
      op, action, frameSeq, geometry };
    const result = JSON.parse(await gatewaySession.request(this.base(binding.conversationId) + '/' + state.report.sessionId + '/control',
      'POST', JSON.stringify(body))) as XopcPhoneEnvelope<XopcPhoneLiveState>;
    return result.payload;
  }
  async ticket(binding: XopcPhoneBinding, state: XopcPhoneLiveState): Promise<XopcPhoneTicket> {
    const body: XopcPhoneTicketRequest = { clientId: this.clientId, purpose: state.ownControl ? 'control' : 'view',
      expectedTranscriptId: binding.transcriptId, epoch: state.ownControl ? state.report.controlEpoch : undefined };
    const result = JSON.parse(await gatewaySession.request(this.base(binding.conversationId) + '/' + state.report.sessionId + '/video-ticket',
      'POST', JSON.stringify(body))) as XopcPhoneEnvelope<XopcPhoneTicket>;
    return result.payload;
  }
  async frame(binding: XopcPhoneBinding): Promise<XopcPhoneFrame> {
    const revision = gatewaySession.connectionRevision();
    const auth = await gatewaySession.transferAuth();
    const connection = http.createHttp();
    const headers: XopcPhoneHttpHeaders = { Authorization: 'Bearer ' + auth.token };
    try {
      const response = await signedHttpRequest(connection, auth.origin + this.base(binding.conversationId) + '/' + binding.phoneSessionId
        + '/frame?expectedTranscriptId=' + encodeURIComponent(binding.transcriptId), { method: http.RequestMethod.GET,
        header: headers, expectDataType: http.HttpDataType.ARRAY_BUFFER, usingCache: false, maxRedirects: 0,
        connectTimeout: 8000, readTimeout: 10000, maxLimit: 8 * 1024 * 1024 });
      gatewaySession.assertConnection(revision);
      if (response.responseCode !== 200) throw new XopcHttpError(response.responseCode);
      if (!(response.result instanceof ArrayBuffer)) throw new Error('INVALID_PHONE_FRAME');
      const fields = JSON.parse(JSON.stringify(response.header)) as Record<string, string>;
      return { bytes: response.result, seq: Number(fields['X-Phone-Frame-Seq'] ?? fields['x-phone-frame-seq']), width: Number(fields['X-Phone-Width'] ?? fields['x-phone-width']),
        height: Number(fields['X-Phone-Height'] ?? fields['x-phone-height']), capturedAt: Number(fields['X-Phone-Captured-At'] ?? fields['x-phone-captured-at']) };
    } finally { connection.destroy(); }
  }
}
