import { composerDraftStorage } from '@/features/chat/session/local-session-drafts';
import { useGatewayStore } from '@/stores/gateway-store';

/** Capture the account and Gateway before any asynchronous work. */
export function clarificationDraftStorage<T>(requestId: string, version: number, category = 'draft', conversationId?: string) {
  const gateway = useGatewayStore.getState();
  let tab = sessionStorage.getItem('xopc.clarification.endpoint');
  if (!tab) { tab = crypto.randomUUID(); sessionStorage.setItem('xopc.clarification.endpoint', tab); }
  const id = `clarification:${gateway.baseUrl}:${tab}:${requestId}:${version}:${category}`;
  if (!gateway.conversationId) return { read: async () => undefined as T | undefined, write: async (_value: T | undefined) => {} };
  return composerDraftStorage<T>(id, conversationId);
}
