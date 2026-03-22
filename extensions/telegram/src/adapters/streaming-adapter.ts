/**
 * Telegram channel streaming: live assistant text via draft stream (OpenClaw-style).
 */

import type {
  ChannelStreamHandle,
  ChannelStreamingAdapter,
} from '@xopcai/xopcbot/channels/plugin-types.js';
import { createLogger } from '@xopcai/xopcbot/utils/logger.js';
import type { ProgressStage } from '@xopcai/xopcbot/agent/progress.js';
import type { TelegramAccountManager } from '../account-manager.js';
import { createTelegramDraftStream } from '../draft-stream.js';
import { renderTelegramHtmlText } from '../format.js';

const log = createLogger('TelegramStreaming');

const DM_MIN_INITIAL_CHARS = 30;

export interface TelegramStreamingAdapterDeps {
  accountManager: TelegramAccountManager;
}

function isProbablyPrivateChat(chatId: string): boolean {
  const n = Number(chatId);
  if (Number.isFinite(n) && n < 0) {
    return false;
  }
  return true;
}

export function createTelegramStreamingAdapter(
  deps: TelegramStreamingAdapterDeps,
): ChannelStreamingAdapter {
  const { accountManager } = deps;

  return {
    startStream(options: {
      chatId: string;
      accountId?: string;
      threadId?: string;
      replyToMessageId?: string;
      parseMode?: 'Markdown' | 'HTML';
    }): ChannelStreamHandle | null {
      const accountId = options.accountId ?? 'default';
      const account = accountManager.getAccount(accountId);
      const streamMode = account?.streamMode ?? 'partial';

      if (streamMode === 'off' || streamMode === 'block') {
        return null;
      }

      const bot = accountManager.getBot(accountId);
      if (!bot) {
        log.warn({ accountId }, 'Streaming skipped: bot not available');
        return null;
      }

      const chatId = options.chatId;
      const threadParsed = options.threadId ? parseInt(options.threadId, 10) : NaN;
      const threadId = Number.isFinite(threadParsed) ? threadParsed : undefined;
      const replyParsed = options.replyToMessageId
        ? parseInt(options.replyToMessageId, 10)
        : NaN;
      const replyToMessageId = Number.isFinite(replyParsed) ? replyParsed : undefined;
      const isPrivate = isProbablyPrivateChat(chatId);

      // OpenClaw: DM uses real message transport to avoid draft→materialize duplicate flash.
      const previewTransport = isPrivate ? ('message' as const) : ('auto' as const);

      const draft = createTelegramDraftStream({
        api: bot.api,
        chatId,
        threadId: Number.isFinite(threadId!) ? threadId : undefined,
        replyToMessageId: Number.isFinite(replyToMessageId!) ? replyToMessageId : undefined,
        previewTransport,
        minInitialChars: isPrivate ? DM_MIN_INITIAL_CHARS : undefined,
        renderText: (text) => ({
          text: renderTelegramHtmlText(text),
          parseMode: 'HTML',
        }),
        warn: (m) => log.warn(m),
      });

      let skipFinalOutbound = false;

      const end = async () => {
        if (draft.previewMode?.() === 'draft' && typeof draft.materialize === 'function') {
          const mid = await draft.materialize();
          skipFinalOutbound = typeof mid === 'number';
          return;
        }
        await draft.flush();
        await draft.stop();
        skipFinalOutbound = typeof draft.messageId() === 'number';
      };

      const abort = async () => {
        await draft.clear();
        skipFinalOutbound = false;
      };

      return {
        update: (text: string) => draft.update(text),
        updateProgress: (text, stage, detail) =>
          draft.updateWithProgress(text, stage as ProgressStage, detail),
        setProgress: (stage, detail) => draft.setProgress(stage as ProgressStage, detail),
        end,
        abort,
        messageId: () => draft.messageId(),
        skipFinalOutbound: () => skipFinalOutbound,
      };
    },
  };
}
