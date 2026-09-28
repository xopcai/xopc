import { create } from 'zustand';

import type { ComposerContextRef, WireAttachment } from './composer.types';
import type { ComposerVoiceCallMode } from './composer-voice-call-options';

export type ComposerHandoff = {
  gatewayId: string;
  conversationId: string | null;
  text: string;
  attachments?: WireAttachment[];
  contextRefs?: ComposerContextRef[];
  autoSend?: boolean;
  voiceCallMode?: ComposerVoiceCallMode;
};

export const useComposerHandoff = create<{
  pending: ComposerHandoff | null;
  set: (handoff: ComposerHandoff) => void;
  consume: (gatewayId: string, conversationId: string, main: boolean) => ComposerHandoff | null;
}>((set, get) => ({
  pending: null,
  set: pending => set({ pending }),
  consume: (gatewayId, conversationId, main) => {
    const pending = get().pending;
    if (!pending || pending.gatewayId !== gatewayId || (pending.conversationId ? pending.conversationId !== conversationId : !main)) return null;
    set({ pending: null });
    return pending;
  },
}));
