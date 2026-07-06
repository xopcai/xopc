import { coerceReasoningLevel } from '@/features/chat/messages/messages.types';
import { DEFAULT_THINKING } from '@/features/chat/session/chat-session-defaults';
import { useChatSessionStore } from '@/features/chat/session/chat-session-store';

export type SessionAgentConfigView = {
  model: string;
  thinkingLevel?: string | null;
  reasoningLevel?: string | null;
  workingDirectoryLocked?: boolean;
};

/** Apply resolved session agent settings to the chat session store slice. */
export function patchSessionAgentConfigView(sessionKey: string, cfg: SessionAgentConfigView): void {
  const key = String(sessionKey ?? '').trim();
  if (!key) return;
  useChatSessionStore.getState().patchSessionMeta(key, {
    model: cfg.model,
    thinkingLevel: cfg.thinkingLevel || DEFAULT_THINKING,
    reasoningLevel: coerceReasoningLevel(cfg.reasoningLevel ?? undefined),
    workingDirectoryLocked: Boolean(cfg.workingDirectoryLocked),
  });
}
