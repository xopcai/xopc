import type { ReplyToMode } from '@xopcai/xopc/channels/channel-domain.js';

/** Per-chat tracker so `replyToMode: first` only applies reply once per inbound turn. */
export class TelegramReplyTracker {
  private firstUsed = new Set<string>();

  private key(accountId: string, chatId: string): string {
    return `${accountId}:${chatId}`;
  }

  reset(accountId: string, chatId: string): void {
    this.firstUsed.delete(this.key(accountId, chatId));
  }

  resolveReplyToMessageId(params: {
    mode?: ReplyToMode;
    explicitReplyTo?: string;
    inboundMessageId?: string;
    accountId: string;
    chatId: string;
  }): string | undefined {
    const mode = params.mode ?? 'off';
    if (params.explicitReplyTo?.trim()) {
      return params.explicitReplyTo.trim();
    }
    const inbound = params.inboundMessageId?.trim();
    if (!inbound) return undefined;

    if (mode === 'off') return undefined;
    if (mode === 'all') return inbound;

    const k = this.key(params.accountId, params.chatId);
    if (this.firstUsed.has(k)) return undefined;
    this.firstUsed.add(k);
    return inbound;
  }
}

export const telegramReplyTracker = new TelegramReplyTracker();
