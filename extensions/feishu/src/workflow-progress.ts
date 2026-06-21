/**
 * Feishu/Lark capability for the workflow progress broker.
 *
 * Feishu exposes `im.v1.message.update`, so we get the same edit-in-place UX
 * as Telegram: send the first snapshot, then update the same message on
 * every subsequent throttled tick. Key events (phase change / new error /
 * tool_end) bypass the throttle so milestones land promptly.
 *
 * Per-bot send rate ~5 msg/sec/account (Feishu open API limit); a 5-second
 * default throttle leaves comfortable headroom even when several workflows
 * run concurrently.
 *
 * Routing: sessionKey `main:feishu:<accountId>:<dm|group|channel>:<peerId>`.
 * - DM peerId is an `open_id` (starts with `ou_`) → use `receive_id_type=open_id`.
 * - Group / channel peerId is a `chat_id` → use `receive_id_type=chat_id`.
 *
 * Failure handling:
 * - "edit must not modify same content" / "message_not_modified" → swallow, keep id.
 * - Edit target gone (deleted / 410-class errors) → fall back to a fresh send.
 * - Other errors → rethrow so the broker logs and drops the update; the next
 *   key event (or the next throttle tick) retries.
 */

import type {
  ChannelProgressCapability,
  WorkflowProgressPostInput,
} from '@xopcai/xopc/agent/workflow/channel-capability.js';
import type { Config } from '@xopcai/xopc/config/schema.js';
import { parseSessionKey } from '@xopcai/xopc/routing/session-key.js';
import { createLogger } from '@xopcai/xopc/utils/logger.js';

import { resolveFeishuAccount } from './state/accounts.js';

const log = createLogger('FeishuWorkflowProgress');

const FEISHU_TEXT_MAX = 4_000;
const DEFAULT_THROTTLE_MS = 5_000;

export function createFeishuWorkflowProgressCapability(opts: {
  getConfig: () => Config | undefined;
}): ChannelProgressCapability {
  return {
    channelId: 'feishu',
    supportsEdit: true,
    defaultThrottleMs: DEFAULT_THROTTLE_MS,
    defaultMode: 'edit',

    async postProgress(input: WorkflowProgressPostInput) {
      const cfg = opts.getConfig();
      if (!cfg) {
        throw new Error('feishu workflow progress: no config loaded');
      }
      const target = resolveTarget(input.sessionKey);
      if (!target) {
        throw new Error(`feishu workflow progress: cannot route sessionKey "${input.sessionKey}"`);
      }

      const account = resolveFeishuAccount(cfg, target.accountId);
      if (!account.configured) {
        throw new Error(
          `feishu workflow progress: account "${target.accountId}" not configured (sessionKey "${input.sessionKey}")`,
        );
      }

      const text = clampForFeishu(input.text);

      // Edit-in-place when we have a previous message id and we're not on the
      // final send. The final tick is always a fresh send so users scrolled
      // past the running bubble can still see the conclusion.
      if (input.previousMessageId && !input.isFinal) {
        try {
          const { editMessageFeishu } = await import('./outbound/actions.js');
          await editMessageFeishu({
            cfg,
            accountId: target.accountId,
            messageId: input.previousMessageId,
            text,
          });
          return { messageId: input.previousMessageId };
        } catch (err) {
          if (isMessageNotModified(err)) {
            return { messageId: input.previousMessageId };
          }
          if (isEditTargetGone(err)) {
            log.debug(
              { sessionKey: input.sessionKey, previousMessageId: input.previousMessageId },
              'edit target gone; falling back to fresh send',
            );
            // fall through to fresh send below
          } else {
            throw err;
          }
        }
      }

      const { createFeishuClient } = await import('./transport/client/client.js');
      const { api } = createFeishuClient(account);
      const receiveIdType = isOpenId(target.peerId) ? 'open_id' : 'chat_id';
      const res: unknown = await (api as { im: { message: { create(arg: unknown): Promise<unknown> } } }).im.message.create({
        params: { receive_id_type: receiveIdType },
        data: {
          receive_id: target.peerId,
          msg_type: 'text',
          content: JSON.stringify({ text }),
        },
      });
      const messageId = extractMessageId(res);
      if (!messageId) {
        throw new Error('feishu workflow progress: send succeeded but no message_id returned');
      }
      return { messageId };
    },
  };
}

interface ResolvedTarget {
  accountId: string;
  peerId: string;
}

function resolveTarget(sessionKey: string): ResolvedTarget | null {
  const parsed = parseSessionKey(sessionKey);
  if (!parsed) return null;
  if (parsed.source !== 'feishu') return null;
  if (!parsed.peerId) return null;
  return {
    accountId: parsed.accountId || 'default',
    peerId: parsed.peerId,
  };
}

function clampForFeishu(text: string): string {
  if (text.length <= FEISHU_TEXT_MAX) return text;
  return `${text.slice(0, FEISHU_TEXT_MAX - 1)}…`;
}

function isOpenId(peerId: string): boolean {
  // Feishu open_id is prefixed `ou_`; chat_id is prefixed `oc_`. Anything
  // else (custom test fixtures, edge cases) defaults to chat_id which is the
  // safer guess for non-DM contexts.
  return peerId.toLowerCase().startsWith('ou_');
}

function extractMessageId(res: unknown): string | undefined {
  if (!res || typeof res !== 'object') return undefined;
  const rec = res as Record<string, unknown>;
  const data = rec.data as Record<string, unknown> | undefined;
  const fromData = typeof data?.message_id === 'string' ? data.message_id : undefined;
  if (fromData) return fromData;
  const direct = typeof rec.message_id === 'string' ? rec.message_id : undefined;
  return direct;
}

function isMessageNotModified(err: unknown): boolean {
  const msg = errorMessage(err).toLowerCase();
  return msg.includes('not_modified') || msg.includes('not modified');
}

function isEditTargetGone(err: unknown): boolean {
  const msg = errorMessage(err).toLowerCase();
  return (
    msg.includes('message_not_found') ||
    msg.includes('message not found') ||
    msg.includes('not exist')
  );
}

function errorMessage(err: unknown): string {
  if (!err) return '';
  if (err instanceof Error) return err.message;
  return String(err);
}
