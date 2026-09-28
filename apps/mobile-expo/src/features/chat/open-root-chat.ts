import type { ImperativeRouter } from 'expo-router';

import { useGatewayStore } from '../../stores/gateway-store';
import { useChatChromeStore } from '../navigation/chat-chrome-store';
import { useChatSelectionStore } from './chat-selection-store';

/** Select a main conversation before revealing the Assistant tab. */
export function openRootChat(router: ImperativeRouter, conversationId: string): boolean {
  const gatewayId = useGatewayStore.getState().activeGatewayId;
  if (!gatewayId || !conversationId.trim()) return false;
  useChatChromeStore.getState().setActionPanelOpen(false);
  useChatSelectionStore.getState().select(gatewayId, conversationId);
  // `dismissTo` is a no-op when invoked from another root tab. `navigate`
  // activates the existing Assistant tab without adding a duplicate route.
  router.navigate('/');
  return true;
}
