/**
 * Telegram capability for the {@link WorkflowProgressBroker}.
 *
 * Strategy: send the first progress update as a fresh message, then edit it in
 * place on every subsequent update. The broker enforces per-channel throttle
 * (default 5 s) and bypasses it for key events (phase change / new error /
 * tool_end), so users always see milestones promptly without us hammering
 * Telegram's edit rate limit.
 *
 * Failure handling is intentionally narrow:
 *   - `message is not modified` from `editMessageText` → swallow (it's a
 *     no-op the broker shouldn't retry).
 *   - Lost / inaccessible message during edit → fall back to a new send so
 *     the user always sees the latest snapshot.
 *   - 429 / network → bubble up, broker logs and drops the update; the next
 *     scheduled (or key) tick will retry.
 *
 * We deliberately use plain text (no parse_mode) — the snapshot renderer
 * emits ASCII-friendly output and we don't want HTML/markdown surprises with
 * `<` in agent labels or shell-style payloads.
 */

import type { ChannelProgressCapability, WorkflowProgressPostInput } from '@xopcai/xopc/agent/workflow/channel-capability.js';
import { parseSessionKey } from '@xopcai/xopc/routing/session-key.js';
import { createLogger } from '@xopcai/xopc/utils/logger.js';

import type { TelegramAccountManager } from './account-manager.js';

const log = createLogger('TelegramWorkflowProgress');

/** Telegram bot API: 4096 char hard cap; leave 96 chars of headroom for re-renders. */
const TELEGRAM_TEXT_MAX = 4000;

/** Telegram bot edit rate ≈ 1/s per chat; broker default 5 s leaves ample headroom. */
const DEFAULT_THROTTLE_MS = 5_000;

export function createTelegramWorkflowProgressCapability(
  accountManager: TelegramAccountManager,
): ChannelProgressCapability {
  return {
    channelId: 'telegram',
    supportsEdit: true,
    defaultThrottleMs: DEFAULT_THROTTLE_MS,
    defaultMode: 'edit',

    async postProgress(input: WorkflowProgressPostInput) {
      const target = resolveTarget(input.sessionKey);
      if (!target) {
        throw new Error(`telegram workflow progress: cannot route sessionKey "${input.sessionKey}"`);
      }
      const bot = accountManager.getBot(target.accountId);
      if (!bot) {
        throw new Error(
          `telegram workflow progress: no bot for accountId "${target.accountId}" (sessionKey "${input.sessionKey}")`,
        );
      }

      const text = clampForTelegram(input.text);

      // Edit-in-place when we have a previous message id and we're not on the
      // final send (final could be substantially longer; sending fresh keeps
      // the conclusion visible even when scrolled past the streaming bubble).
      if (input.previousMessageId && !input.isFinal) {
        try {
          await bot.api.editMessageText(
            target.chatId,
            Number(input.previousMessageId),
            text,
          );
          return { messageId: input.previousMessageId };
        } catch (err) {
          if (isMessageNotModified(err)) {
            // Snapshot rendered identically to the last edit (e.g. only
            // running spinner ticked) — silently keep the same message id.
            return { messageId: input.previousMessageId };
          }
          if (isEditTargetGone(err)) {
            log.debug(
              { sessionKey: input.sessionKey, previousMessageId: input.previousMessageId },
              'edit target gone; falling back to sendMessage',
            );
            // fall through to the send path below
          } else {
            throw err;
          }
        }
      }

      const sent = await bot.api.sendMessage(target.chatId, text, {
        message_thread_id: target.threadId ? Number(target.threadId) : undefined,
        disable_notification: !input.isFinal,
      });
      return { messageId: String(sent.message_id) };
    },
  };
}

interface ResolvedTarget {
  accountId: string;
  chatId: string;
  threadId?: string;
}

function resolveTarget(sessionKey: string): ResolvedTarget | null {
  const parsed = parseSessionKey(sessionKey);
  if (!parsed) return null;
  if (parsed.source !== 'telegram') return null;
  if (!parsed.peerId) return null;
  return {
    accountId: parsed.accountId,
    chatId: parsed.peerId,
    threadId: parsed.threadId,
  };
}

function clampForTelegram(text: string): string {
  if (text.length <= TELEGRAM_TEXT_MAX) return text;
  return `${text.slice(0, TELEGRAM_TEXT_MAX - 1)}…`;
}

function isMessageNotModified(err: unknown): boolean {
  const msg = errorMessage(err).toLowerCase();
  return msg.includes('message is not modified');
}

function isEditTargetGone(err: unknown): boolean {
  const msg = errorMessage(err).toLowerCase();
  return (
    msg.includes('message to edit not found') ||
    msg.includes("message can't be edited") ||
    msg.includes('chat not found')
  );
}

function errorMessage(err: unknown): string {
  if (!err) return '';
  if (err instanceof Error) return err.message;
  return String(err);
}
