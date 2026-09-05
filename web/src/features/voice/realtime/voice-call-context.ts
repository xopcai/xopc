import { createContext, useContext } from 'react';

export interface VoiceCallTarget {
  sessionKey: string;
  name: string;
  taskId?: string;
}

export interface VoiceCallContextValue {
  active: boolean;
  sessionKey: string | null;
  open: (target: VoiceCallTarget) => void;
}

export const VoiceCallContext = createContext<VoiceCallContextValue | null>(null);

export function useVoiceCall(): VoiceCallContextValue {
  const context = useContext(VoiceCallContext);
  if (!context) throw new Error('VoiceCallProvider is required');
  return context;
}
