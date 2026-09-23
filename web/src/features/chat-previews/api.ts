import type {
  ChatPreviewFixGuidance,
  ChatPreviewFixGuidanceInput,
  ChatPreviewRevision,
  LocalAppDetail,
} from '@xopcai/gateway-contract';

import { fetchJson } from '@/lib/fetch';
import { apiUrl } from '@/lib/url';

export async function getChatPreviewRevision(id: string, sourceHash: string): Promise<ChatPreviewRevision> {
  return (await fetchJson<{ revision: ChatPreviewRevision }>(apiUrl(
    `/api/chat-previews/${encodeURIComponent(id)}/revisions/${encodeURIComponent(sourceHash)}`,
  ))).revision;
}

export async function getChatPreviewFixGuidance(
  id: string,
  input: ChatPreviewFixGuidanceInput,
): Promise<ChatPreviewFixGuidance> {
  return (await fetchJson<{ guidance: ChatPreviewFixGuidance }>(apiUrl(
    `/api/chat-previews/${encodeURIComponent(id)}/fix-guidance`,
  ), { method: 'POST', body: JSON.stringify(input) })).guidance;
}

export async function promoteChatPreview(id: string, sourceHash: string): Promise<LocalAppDetail> {
  return (await fetchJson<{ app: LocalAppDetail }>(apiUrl(
    `/api/chat-previews/${encodeURIComponent(id)}/promote`,
  ), { method: 'POST', body: JSON.stringify({ sourceHash }) })).app;
}
