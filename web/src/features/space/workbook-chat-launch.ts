import type { ComposerContextRef } from '@/features/chat/composer/composer.types';
import { useGatewayStore } from '@/stores/gateway-store';

type WorkbookLaunch = { text: string; reference: ComposerContextRef };
const launches = new Map<string, WorkbookLaunch>();

const conversationKey = (id: string) => `xopc.workbook-chat:${useGatewayStore.getState().baseUrl}:${id}`;

export function rememberWorkbookConversation(id: string, conversationId: string) {
  try { sessionStorage.setItem(conversationKey(id), conversationId); } catch { /* Storage can be unavailable. */ }
}

export function previousWorkbookConversation(id: string) {
  try { return sessionStorage.getItem(conversationKey(id)); } catch { return null; }
}

export function createWorkbookChatLaunch(text: string, reference: ComposerContextRef) {
  const id = crypto.randomUUID();
  launches.set(id, { text, reference });
  return id;
}

export function takeWorkbookChatLaunch(id: string) {
  const launch = launches.get(id);
  launches.delete(id);
  return launch;
}
