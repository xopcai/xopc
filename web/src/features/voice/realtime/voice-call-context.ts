import { createContext, useContext } from 'react';
import type { NaturalVoiceBackend, VoiceMode } from '@xopcai/realtime-protocol/voice';

export interface VoiceCallTarget {
  conversationId: string;
  name: string;
  taskId?: string;
  mode?: VoiceMode;
  naturalBackend?: NaturalVoiceBackend;
}

export interface VoiceCallContextValue {
  active: boolean;
  conversationId: string | null;
  open: (target: VoiceCallTarget) => void;
}

export const VoiceCallContext = createContext<VoiceCallContextValue | null>(null);

export function useVoiceCall(): VoiceCallContextValue {
  const context = useContext(VoiceCallContext);
  if (!context) throw new Error('VoiceCallProvider is required');
  return context;
}
