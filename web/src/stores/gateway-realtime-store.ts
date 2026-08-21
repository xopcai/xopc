import { create } from 'zustand';

import type { RealtimeConnectionState } from '@xopcai/realtime-client';

type GatewayRealtimeStore = {
  connectionState: RealtimeConnectionState;
  error: string | null;
};

export const useGatewayRealtimeStore = create<GatewayRealtimeStore>(() => ({
  connectionState: 'idle',
  error: null,
}));

export function setRealtimeConnectionState(partial: Partial<GatewayRealtimeStore>): void {
  useGatewayRealtimeStore.setState(partial);
}
