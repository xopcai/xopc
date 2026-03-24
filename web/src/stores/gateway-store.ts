import { create } from 'zustand';

import { clearToken, getToken, setToken as persistToken } from '@/lib/storage';

export type GatewayState = {
  baseUrl: string;
  token: string | undefined;
  tokenDialogOpen: boolean;
  tokenExpired: boolean;
  setGatewayToken: (token: string) => void;
  clearGatewayToken: () => void;
  openTokenDialog: () => void;
  closeTokenDialog: () => void;
  onUnauthorized: () => void;
};

export const useGatewayStore = create<GatewayState>((set, get) => ({
  baseUrl: typeof window !== 'undefined' ? window.location.origin : '',
  token: undefined,
  tokenDialogOpen: false,
  tokenExpired: false,

  setGatewayToken: (token) => {
    persistToken(token);
    set({ token, tokenDialogOpen: false, tokenExpired: false });
    window.dispatchEvent(new CustomEvent('token-saved', { detail: { token } }));
  },

  clearGatewayToken: () => {
    clearToken();
    set({ token: undefined });
  },

  openTokenDialog: () => set({ tokenDialogOpen: true }),

  closeTokenDialog: () => set({ tokenDialogOpen: false }),

  onUnauthorized: () => {
    get().clearGatewayToken();
    set({ tokenDialogOpen: true, tokenExpired: true });
    window.dispatchEvent(new CustomEvent('token-expired'));
  },
}));

export function initGatewayFromWindow(): void {
  const params = new URLSearchParams(window.location.search);
  const urlToken = params.get('token');
  if (urlToken) {
    useGatewayStore.getState().setGatewayToken(urlToken);
    const clean = window.location.pathname + window.location.hash;
    window.history.replaceState({}, '', clean);
    return;
  }
  const stored = getToken();
  useGatewayStore.setState({
    token: stored || undefined,
    tokenDialogOpen: !stored,
  });
}
