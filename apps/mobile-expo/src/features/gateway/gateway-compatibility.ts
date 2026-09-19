import { create } from 'zustand';

import {
  isRealtimeCompatibilityErrorCode,
  type RealtimeCompatibilityErrorCode,
} from '@xopcai/realtime-protocol';

type GatewayCompatibilityState = {
  issue: RealtimeCompatibilityErrorCode | null;
  setIssue: (issue: RealtimeCompatibilityErrorCode) => void;
  clearIssue: () => void;
};

export const useGatewayCompatibility = create<GatewayCompatibilityState>((set) => ({
  issue: null,
  setIssue: (issue) => set({ issue }),
  clearIssue: () => set({ issue: null }),
}));

export function readGatewayCompatibilityIssue(value: unknown): RealtimeCompatibilityErrorCode | null {
  return isRealtimeCompatibilityErrorCode(value) ? value : null;
}
