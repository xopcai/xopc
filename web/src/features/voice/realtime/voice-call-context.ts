import { createContext, useContext, type ReactNode } from 'react';
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
  expanded: boolean;
  minimize: () => void;
  setMiniAnchor: (element: HTMLElement | null) => void;
  conversationId: string | null;
  open: (target: VoiceCallTarget, presentation?: { anchor: HTMLElement; avatar: ReactNode }) => void;
}

export const VoiceCallContext = createContext<VoiceCallContextValue | null>(null);

export function useVoiceCall(): VoiceCallContextValue {
  const context = useContext(VoiceCallContext);
  if (!context) throw new Error('VoiceCallProvider is required');
  return context;
}
