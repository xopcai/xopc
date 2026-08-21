import { MessageSender } from '@/features/chat/messages/message-sender';

/**
 * Singleton owner of in-flight webchat run subscriptions.
 * Survives route changes; callbacks write to {@link useChatSessionStore}, not hook state.
 */
class ChatRunManager {
  private static instance: ChatRunManager | undefined;

  readonly sender = new MessageSender();
  activeStreamSessionKey: string | null = null;
  activeResumeRunId: string | null = null;
  userAborted = false;

  static get(): ChatRunManager {
    if (!ChatRunManager.instance) {
      ChatRunManager.instance = new ChatRunManager();
    }
    return ChatRunManager.instance;
  }

  clearActiveStreamSessionKey(sessionKey?: string): void {
    if (sessionKey && this.activeStreamSessionKey !== sessionKey) return;
    this.activeStreamSessionKey = null;
  }

  resetRunTracking(): void {
    this.activeStreamSessionKey = null;
    this.activeResumeRunId = null;
  }

  abort(): void {
    this.sender.abort();
  }

  isStreamingFor(chatId: string): boolean {
    return this.sender.isStreamingFor(chatId);
  }

  get isSending(): boolean {
    return this.sender.isSending;
  }
}

export const chatRunManager = ChatRunManager.get();

/** Ref-shaped accessor for hooks that still expect `RefObject<string | null>`. */
export const chatRunSessionKeyRef = {
  get current(): string | null {
    return chatRunManager.activeStreamSessionKey;
  },
  set current(value: string | null) {
    chatRunManager.activeStreamSessionKey = value;
  },
};
