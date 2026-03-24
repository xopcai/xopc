import { create } from 'zustand';

import type { SseConnectionState } from '@/features/gateway/types';

type GatewaySseStore = {
  connectionState: SseConnectionState;
  error: string | null;
  reconnectAttempt: number;
};

export const useGatewaySseStore = create<GatewaySseStore>(() => ({
  connectionState: 'idle',
  error: null,
  reconnectAttempt: 0,
}));

export function setSseConnectionState(
  partial: Partial<Pick<GatewaySseStore, 'connectionState' | 'error' | 'reconnectAttempt'>>,
): void {
  useGatewaySseStore.setState(partial);
}
