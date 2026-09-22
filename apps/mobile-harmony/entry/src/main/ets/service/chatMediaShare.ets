import { common } from '@kit.AbilityKit';
import { uniformTypeDescriptor as utd } from '@kit.ArkData';
import { systemShare } from '@kit.ShareKit';
import { XopcHistoryMedia } from '../model/chat';
import { gatewaySession } from './gatewaySession';

export type XopcShareReachability = 'public' | 'lan' | 'local-only';

export interface XopcShareRequest {
  fileId?: string;
  path?: string;
  conversationId?: string;
  audience: string;
}

export interface XopcShareDetails {
  id: string;
  kind: string;
  title: string;
  description: string;
  shareUrl: string;
  lanUrl?: string | null;
  reachability: XopcShareReachability;
  reachabilityHint?: string | null;
  expiresAt: string;
  maxViews?: number | null;
}

export interface XopcSharePayload { share: XopcShareDetails; }
interface XopcShareEnvelope { ok: boolean; payload?: XopcSharePayload; }

export function chatMediaShareRequest(file: XopcHistoryMedia, conversationId: string): XopcShareRequest | undefined {
  const explicitId = file.fileId?.trim() || '';
  let uriId = '';
  if (!explicitId && file.uri.startsWith('xopc-file:')) {
    try { uriId = decodeURIComponent(file.uri.slice(10)).trim(); } catch (_) { return undefined; }
  }
  const fileId = explicitId || uriId;
  if (fileId) return { fileId, conversationId: conversationId || undefined, audience: 'friend' };
  const path = file.workspaceRelativePath?.trim() || '';
  if (path && conversationId) return { path, conversationId, audience: 'friend' };
  return undefined;
}

export async function createManagedShare(request: XopcShareRequest): Promise<XopcSharePayload> {
  const result = JSON.parse(await gatewaySession.request('/api/shares/auto', 'POST', JSON.stringify(request))) as XopcShareEnvelope;
  const payload = result.payload;
  if (!result.ok || !payload?.share?.id || !/^https?:\/\//i.test(payload.share.shareUrl)
    || !['public', 'lan', 'local-only'].includes(payload.share.reachability)) throw new Error('INVALID_SHARE_RESPONSE');
  return payload;
}

export async function createChatMediaShare(file: XopcHistoryMedia, conversationId: string): Promise<XopcSharePayload> {
  const request = chatMediaShareRequest(file, conversationId);
  if (!request) throw new Error('SHARE_SOURCE_UNAVAILABLE');
  return createManagedShare(request);
}

export function shareReachabilityText(share: XopcShareDetails, chinese: boolean): string {
  const status = share.reachability === 'public' ? (chinese ? '公网可访问' : 'Publicly reachable')
    : share.reachability === 'lan' ? (chinese ? '仅同一局域网可访问' : 'Reachable on the same LAN')
      : (chinese ? '目前仅本机可访问' : 'Currently local to your computer');
  return status + (share.reachabilityHint ? '\n' + share.reachabilityHint : '');
}

export async function shareChatLink(context: common.UIAbilityContext, share: XopcShareDetails): Promise<void> {
  const title = share.title.trim() || 'xopc';
  const content = title + '\n' + share.shareUrl;
  if (content.length * 3 > 190000) throw new Error('SHARE_TOO_LARGE');
  const data = new systemShare.SharedData({ utd: utd.UniformDataType.PLAIN_TEXT, content, title });
  await new systemShare.ShareController(data).show(context,
    { selectionMode: systemShare.SelectionMode.SINGLE, previewMode: systemShare.SharePreviewMode.DEFAULT });
}
