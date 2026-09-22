import { gatewaySession } from './gatewaySession';
import {
  XopcSessionSharePreview, XopcSessionSharePreviewEnvelope, XopcShareItem, XopcShareListEnvelope,
  XopcShareResult, XopcShareResultEnvelope
} from '../model/share';

interface XopcNoteShareRequest { expectedNoteVersion: number; ttlMs: number; }
interface XopcSessionShareRequest {
  expectedTranscriptId: string;
  expectedCutoffSeq: number;
  expectedMetadataUpdatedAt: string;
  ttlMs: number;
  maxViews: number | null;
  includeToolActivities: boolean;
}
interface XopcShareExtensionRequest { extendTtlMs: number; }

function validShareUrl(value: string): boolean { return value.startsWith('https://') || value.startsWith('http://'); }

function validateShare(result: XopcShareResult): XopcShareResult {
  if (!result?.id || !validShareUrl(result.shareUrl) || !['public', 'lan', 'local-only'].includes(result.reachability)) {
    throw new Error('INVALID_SHARE_RESPONSE');
  }
  return result;
}

export class XopcShareService {
  async list(): Promise<XopcShareItem[]> {
    const envelope = JSON.parse(await gatewaySession.request('/api/shares')) as XopcShareListEnvelope;
    if (!envelope.ok || !Array.isArray(envelope.payload?.shares)) throw new Error('INVALID_SHARE_LIST');
    return envelope.payload.shares.filter((item: XopcShareItem): boolean => !!item?.id && validShareUrl(item.shareUrl));
  }

  async revoke(id: string): Promise<void> {
    if (!id) throw new Error('INVALID_SHARE_ID');
    await gatewaySession.request('/api/shares/' + encodeURIComponent(id), 'DELETE');
  }

  async extend(id: string, ttlMs: number): Promise<void> {
    if (!id || !Number.isFinite(ttlMs) || ttlMs <= 0) throw new Error('INVALID_SHARE_EXTENSION');
    const body: XopcShareExtensionRequest = { extendTtlMs: ttlMs };
    await gatewaySession.request('/api/shares/' + encodeURIComponent(id), 'PATCH', JSON.stringify(body));
  }

  async note(noteId: string, version: number): Promise<XopcShareResult> {
    if (!noteId || !Number.isFinite(version) || version <= 0) throw new Error('INVALID_NOTE_SHARE');
    const body: XopcNoteShareRequest = { expectedNoteVersion: version, ttlMs: 86400000 };
    const envelope = JSON.parse(await gatewaySession.request('/api/notes/' + encodeURIComponent(noteId) + '/shares',
      'POST', JSON.stringify(body))) as XopcShareResultEnvelope;
    const result = validateShare(envelope.payload);
    result.title = result.title || result.fileName || 'Note';
    return result;
  }

  async sessionPreview(conversationId: string): Promise<XopcSessionSharePreview> {
    const envelope = JSON.parse(await gatewaySession.request('/api/sessions/' + encodeURIComponent(conversationId)
      + '/share-preview')) as XopcSessionSharePreviewEnvelope;
    const preview = envelope.payload;
    if (!envelope.ok || !preview?.transcriptId || !Number.isFinite(preview.cutoffSeq)
      || !preview.metadataUpdatedAt || !Number.isFinite(preview.messageCount)) throw new Error('INVALID_SESSION_SHARE_PREVIEW');
    preview.attachmentCandidates = Array.isArray(preview.attachmentCandidates) ? preview.attachmentCandidates : [];
    return preview;
  }

  async session(conversationId: string, preview: XopcSessionSharePreview): Promise<XopcShareResult> {
    const body: XopcSessionShareRequest = {
      expectedTranscriptId: preview.transcriptId, expectedCutoffSeq: preview.cutoffSeq,
      expectedMetadataUpdatedAt: preview.metadataUpdatedAt, ttlMs: 86400000, maxViews: null,
      includeToolActivities: true
    };
    const envelope = JSON.parse(await gatewaySession.request('/api/sessions/' + encodeURIComponent(conversationId)
      + '/shares', 'POST', JSON.stringify(body))) as XopcShareResultEnvelope;
    const result = validateShare(envelope.payload);
    result.title = result.title || result.fileName || preview.title || 'Conversation';
    return result;
  }
}

export const shareService: XopcShareService = new XopcShareService();
