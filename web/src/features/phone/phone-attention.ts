import { create } from 'zustand';
import { persist } from 'zustand/middleware';

import { useGatewayStore } from '@/stores/gateway-store';
import type { PhoneLiveState } from './phone-live-api';

export function phoneAttentionKey(conversationId: string, report: PhoneLiveState['report']): string | null {
  if (!report.assistanceId || !['needs_user', 'paused'].includes(report.status)) return null;
  const gateway = useGatewayStore.getState();
  return JSON.stringify([gateway.baseUrl, gateway.conversationId, conversationId, report.transcriptId,
    report.assistanceId, report.assistanceVersion ?? 1]);
}
export const usePhoneAttention = create(persist<{
  seen: string[]; markSeen: (key: string) => void;
}>((set) => ({
  seen: [], markSeen: key => set(state => state.seen.includes(key) ? state : { seen: [...state.seen.slice(-99), key] }),
}), { name: 'xopc-phone-attention-v1' }));
