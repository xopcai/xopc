import { create } from 'zustand';

type Handoff = { gatewayId: string; conversationId: string | null; text: string };
export const useComposerHandoff = create<{ pending: Handoff | null; set: (handoff: Handoff) => void; consume: (gatewayId: string, conversationId: string, main: boolean) => string | null }>((set, get) => ({
  pending: null,
  set: pending => set({ pending }),
  consume: (gatewayId, conversationId, main) => {
    const pending = get().pending;
    if (!pending || pending.gatewayId !== gatewayId || (pending.conversationId ? pending.conversationId !== conversationId : !main)) return null;
    set({ pending: null });
    return pending.text;
  },
}));
