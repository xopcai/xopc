/**
 * WeChat capability for the workflow progress broker.
 *
 * WeChat (ilink/personal account) does not expose an "edit message" API for
 * bot replies, so live edit-in-place — what Telegram and Feishu do — is
 * structurally impossible. Trying to fake it with a `append` mode would
 * spam the chat with one message per tick, which violates the social
 * properties of the surface ("Don't @ me twenty times").
 *
 * Strategy: **final-only**. The broker silently drops every mid-run update;
 * when `tool_end` fires, the broker calls us once with `isFinal: true` and
 * the full final snapshot rendered as text. The user sees a single
 * tasteful summary at the end.
 *
 * Routing: sessionKey `agent:main:weixin:<accountId>:direct:<ilinkUserId>`. We need a
 * valid `contextToken` for the recipient — which requires the user to have
 * recently messaged the bot (the token is harvested from inbound). If
 * missing, we throw and the broker logs; the run still completes, just
 * without a WeChat notification. This is consistent with how other WeChat
 * outbound paths behave.
 */

import type {
  ChannelProgressCapability,
  WorkflowProgressPostInput,
} from '@xopcai/xopc/agent/workflow/index.js';
import type { Config } from '@xopcai/xopc/config/schema.js';
import { parseSessionKey } from '@xopcai/xopc/routing/session-key.js';
import { createLogger } from '@xopcai/xopc/utils/logger.js';

import { resolveWeixinAccount } from './auth/accounts.js';
import { ensureWeixinContextTokenForOutbound } from './messaging/context-token-init.js';
import { getContextToken } from './messaging/inbound.js';
import { sendMessageWeixin } from './messaging/send.js';

const log = createLogger('WeixinWorkflowProgress');

const WEIXIN_TEXT_MAX = 4_000;
/**
 * Conservative throttle — only enforced when the user overrides the default
 * `final-only` mode to `append`. Set so back-to-back workflows can't spam.
 */
const DEFAULT_THROTTLE_MS = 60_000;

export function createWeixinWorkflowProgressCapability(opts: {
  getConfig: () => Config | undefined;
}): ChannelProgressCapability {
  return {
    channelId: 'weixin',
    supportsEdit: false,
    defaultThrottleMs: DEFAULT_THROTTLE_MS,
    defaultMode: 'final-only',

    async postProgress(input: WorkflowProgressPostInput) {
      const cfg = opts.getConfig();
      if (!cfg) {
        throw new Error('weixin workflow progress: no config loaded');
      }
      const target = resolveTarget(input.sessionKey);
      if (!target) {
        throw new Error(`weixin workflow progress: cannot route sessionKey "${input.sessionKey}"`);
      }

      let account;
      try {
        account = resolveWeixinAccount(cfg, target.accountId);
      } catch (err) {
        throw new Error(
          `weixin workflow progress: cannot resolve account "${target.accountId}": ${errorMessage(err)}`,
        );
      }
      if (!account.configured || !account.token) {
        throw new Error(
          `weixin workflow progress: account "${target.accountId}" not configured / logged in`,
        );
      }

      let ctxTok = getContextToken(account.accountId, target.to)?.trim();
      if (!ctxTok) {
        ctxTok = (await ensureWeixinContextTokenForOutbound(account.accountId, target.to, account))?.trim();
      }
      if (!ctxTok) {
        // No usable context token — without one WeChat refuses outbound. Better
        // to drop the progress notice than to spam an error; the parent agent
        // still surfaces the result through its normal reply path.
        log.debug(
          { sessionKey: input.sessionKey, accountId: account.accountId },
          'no context token for recipient; skipping workflow progress send',
        );
        return { messageId: '' };
      }

      const text = clampForWeixin(decorateForWeixin(input.text, input.mode, input.isFinal));
      const r = await sendMessageWeixin({
        to: target.to,
        text,
        opts: {
          baseUrl: account.baseUrl,
          token: account.token,
          routeTag: account.routeTag,
          contextToken: ctxTok,
        },
      });
      return { messageId: r.messageId };
    },
  };
}

interface ResolvedTarget {
  accountId: string;
  to: string;
}

function resolveTarget(sessionKey: string): ResolvedTarget | null {
  const parsed = parseSessionKey(sessionKey);
  if (!parsed) return null;
  if (parsed.source !== 'weixin') return null;
  if (!parsed.peerId) return null;
  return {
    accountId: parsed.accountId || 'default',
    to: parsed.peerId,
  };
}

function clampForWeixin(text: string): string {
  if (text.length <= WEIXIN_TEXT_MAX) return text;
  return `${text.slice(0, WEIXIN_TEXT_MAX - 1)}…`;
}

/**
 * Add a one-line header on append-mode messages so the user can tell mid-run
 * snapshots apart from the final summary — WeChat has no editMessage, so they
 * pile up as separate messages and look identical without a marker.
 *
 *   - `final-only` mode: no header (default; one summary message per run).
 *   - `append` mode + mid-run: "▾ 工作流进展" header so the user knows more
 *     updates are coming.
 *   - `append` mode + final: "✓ 工作流完成" header to mark the conclusion.
 *
 * `edit` mode is never reached on WeChat (`supportsEdit: false`), so we don't
 * branch on it. Unknown / missing mode falls through to no header — safe
 * default for hand-rolled callers and tests.
 */
function decorateForWeixin(
  text: string,
  mode: string | undefined,
  isFinal: boolean,
): string {
  if (mode !== 'append') return text;
  const header = isFinal ? '✓ 工作流完成' : '▾ 工作流进展';
  return `${header}\n${text}`;
}

function errorMessage(err: unknown): string {
  if (!err) return '';
  if (err instanceof Error) return err.message;
  return String(err);
}
