import { create } from 'zustand';
import { useGatewayStore } from '@/stores/gateway-store';
import type { EmbeddedBrowserState } from '../../../../electron/browser/types';

export const useEmbeddedBrowserStore = create<{ tabs: Record<string, EmbeddedBrowserState>; update: (state: EmbeddedBrowserState) => void }>(set => ({
  tabs: {}, update: state => set(current => ({ tabs: { ...current.tabs, [state.workspaceTabId]: state } })),
}));
export async function closeEmbeddedBrowser(workspaceTabId: string) {
  const state = useEmbeddedBrowserStore.getState().tabs[workspaceTabId];
  if (state && window.electronAPI?.browser && !await window.electronAPI.browser.close(state.id)) return false;
  useEmbeddedBrowserStore.setState(current => ({ tabs: Object.fromEntries(Object.entries(current.tabs).filter(([id]) => id !== workspaceTabId)) }));
  return true;
}
useGatewayStore.subscribe((state, previous) => {
  if (state.baseUrl !== previous.baseUrl || (previous.conversationId && state.conversationId !== previous.conversationId)) {
    useEmbeddedBrowserStore.setState({ tabs: {} });
    void window.electronAPI?.browser?.release().catch(() => {});
  }
});
