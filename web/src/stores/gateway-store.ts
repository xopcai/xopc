import { create } from 'zustand';
import { readUnmigratedGatewayCredential, removeUnmigratedGatewayCredential } from '@/lib/storage';

export type GatewayState = {
  baseUrl: string;
  /** Public cache namespace; never an authentication credential. */
  conversationId: string | undefined;
  tokenDialogOpen: boolean;
  tokenExpired: boolean;
  setBrowserSession: (conversationId: string) => void;
  clearBrowserSession: () => void;
  openTokenDialog: () => void;
  closeTokenDialog: () => void;
  onUnauthorized: () => void;
};
export const useGatewayStore = create<GatewayState>((set) => ({
  baseUrl: typeof window !== 'undefined' ? window.location.origin : '',
  conversationId: undefined, tokenDialogOpen: false, tokenExpired: false,
  setBrowserSession: (conversationId) => {
    removeUnmigratedGatewayCredential();
    set({ conversationId, tokenDialogOpen: false, tokenExpired: false });
    window.dispatchEvent(new CustomEvent('gateway-authenticated'));
  },
  clearBrowserSession: () => {
    void fetch('/api/browser-session', { method: 'DELETE', credentials: 'same-origin', redirect: 'error', signal: AbortSignal.timeout(8_000) }).catch(() => {});
    set({ conversationId: undefined });
  },
  openTokenDialog: () => set({ tokenDialogOpen: true }),
  closeTokenDialog: () => set({ tokenDialogOpen: false }),
  onUnauthorized: () => {
    set({ conversationId: undefined, tokenDialogOpen: false, tokenExpired: true });
    window.dispatchEvent(new CustomEvent('gateway-auth-expired'));
  },
}));

export async function establishBrowserSession(credential: string): Promise<Response> {
  return fetch('/api/browser-session', { method: 'POST', credentials: 'same-origin', redirect: 'error', signal: AbortSignal.timeout(8_000), headers: { Authorization: `Bearer ${credential}` } });
}

export async function initGatewayFromWindow(): Promise<void> {
  try {
    const response = await fetch('/api/browser-session', { credentials: 'same-origin', redirect: 'error', signal: AbortSignal.timeout(8_000) });
    if (response.ok) {
      const body = await response.json() as { conversationId?: string };
      if (body.conversationId) { useGatewayStore.getState().setBrowserSession(body.conversationId); return; }
    }
    if (response.status !== 401) return;
    const getCredential = window.electronAPI?.gateway?.getCredential;
    const credential = typeof getCredential === 'function' ? await getCredential() : readUnmigratedGatewayCredential();
    if (!credential) return;
    const exchanged = await establishBrowserSession(credential);
    if (!exchanged.ok) return;
    const body = await exchanged.json() as { conversationId?: string };
    if (body.conversationId) useGatewayStore.getState().setBrowserSession(body.conversationId);
  } catch { /* Keep bootstrap retryable when the local Gateway is still starting. */ }
}
