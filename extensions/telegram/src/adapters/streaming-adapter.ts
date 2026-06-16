/**
 * Telegram channel streaming: live assistant text via draft stream.
 */

import type {
  ChannelStreamHandle,
  ChannelStreamingAdapter,
} from '@xopcai/xopc/channels/plugin-types.js';
import { createLogger } from '@xopcai/xopc/utils/logger.js';
import type { ProgressStage } from '@xopcai/xopc/agent/lifecycle/progress.js';
import type { TelegramAccountManager } from '../account-manager.js';
import { createTelegramDraftStream } from '../draft-stream.js';
import { renderTelegramHtmlText } from '../format.js';
import { resolveTelegramStreamingMode } from '../config-schema.js';
import { telegramReplyTracker } from '../reply-params.js';

const log = createLogger('TelegramStreaming');

const DM_MIN_INITIAL_CHARS = 30;
const BLOCK_DEFAULT_COALESCE = { minChars: 800, idleMs: 1000 };

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
      const streamMode = account ? resolveTelegramStreamingMode(account) : 'partial';

      if (streamMode === 'off') {
        return null;
      }

      const bot = accountManager.getBot(accountId);
      if (!bot) {
        log.warn({ accountId }, 'Streaming skipped: bot not available');
        return null;
      }

      const chatId = options.chatId;
      telegramReplyTracker.reset(accountId, chatId);

      const replyToMessageId = telegramReplyTracker.resolveReplyToMessageId({
        mode: account?.replyToMode,
        explicitReplyTo: options.replyToMessageId,
        inboundMessageId: options.replyToMessageId,
        accountId,
        chatId,
      });

      const threadParsed = options.threadId ? parseInt(options.threadId, 10) : NaN;
      const threadId = Number.isFinite(threadParsed) ? threadParsed : undefined;
      const replyParsed = replyToMessageId ? parseInt(replyToMessageId, 10) : NaN;
      const replyId = Number.isFinite(replyParsed) ? replyParsed : undefined;
      const isPrivate = isProbablyPrivateChat(chatId);

      const previewTransport = isPrivate ? ('message' as const) : ('auto' as const);
      const blockCoalesce = account?.streaming?.block?.coalesce;
      const throttleMs =
        streamMode === 'block'
          ? Math.max(250, blockCoalesce?.idleMs ?? BLOCK_DEFAULT_COALESCE.idleMs)
          : undefined;

      const draft = createTelegramDraftStream({
        api: bot.api,
        chatId,
        threadId: Number.isFinite(threadId!) ? threadId : undefined,
        replyToMessageId: Number.isFinite(replyId!) ? replyId : undefined,
        previewTransport,
        throttleMs,
        minInitialChars: isPrivate ? DM_MIN_INITIAL_CHARS : undefined,
        renderText: (text) => ({
          text: renderTelegramHtmlText(text),
          parseMode: 'HTML',
        }),
        warn: (m) => log.warn(m),
      });

      let reasoningDraft: ReturnType<typeof createTelegramDraftStream> | null = null;
      let pendingBlockBuffer = '';
      let blockFlushTimer: ReturnType<typeof setTimeout> | undefined;
      const blockMinChars = blockCoalesce?.minChars ?? BLOCK_DEFAULT_COALESCE.minChars;
      const blockIdleMs = blockCoalesce?.idleMs ?? BLOCK_DEFAULT_COALESCE.idleMs;

      const flushBlockBuffer = () => {
        if (!pendingBlockBuffer) return;
        draft.update(pendingBlockBuffer);
        pendingBlockBuffer = '';
      };

      const scheduleBlockFlush = () => {
        if (blockFlushTimer) clearTimeout(blockFlushTimer);
        blockFlushTimer = setTimeout(() => {
          blockFlushTimer = undefined;
          flushBlockBuffer();
        }, blockIdleMs);
        blockFlushTimer.unref?.();
      };

      let skipFinalOutbound = false;

      const end = async () => {
        if (streamMode === 'block') {
          if (blockFlushTimer) {
            clearTimeout(blockFlushTimer);
            blockFlushTimer = undefined;
          }
          flushBlockBuffer();
        }
        if (reasoningDraft) {
          await reasoningDraft.stop();
          reasoningDraft = null;
        }
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
        if (blockFlushTimer) {
          clearTimeout(blockFlushTimer);
          blockFlushTimer = undefined;
        }
        pendingBlockBuffer = '';
        if (reasoningDraft) {
          await reasoningDraft.clear();
          reasoningDraft = null;
        }
        await draft.clear();
        skipFinalOutbound = false;
      };

      const update = (text: string) => {
        if (streamMode === 'block') {
          pendingBlockBuffer = text;
          if (text.length >= blockMinChars) {
            flushBlockBuffer();
            return;
          }
          scheduleBlockFlush();
          return;
        }
        draft.update(text);
      };

      const updateReasoning = (text: string) => {
        if (!reasoningDraft) {
          reasoningDraft = createTelegramDraftStream({
            api: bot.api,
            chatId,
            threadId: Number.isFinite(threadId!) ? threadId : undefined,
            previewTransport: 'message',
            renderText: (t) => ({
              text: `💭 ${renderTelegramHtmlText(t)}`,
              parseMode: 'HTML',
            }),
            warn: (m) => log.warn(m),
          });
        }
        reasoningDraft.update(text);
      };

      return {
        update,
        updateReasoning,
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
