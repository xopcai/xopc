import path from 'node:path';

import type { Config } from '@xopcai/xopcbot/config/schema.js';
import type {
  ChannelOutboundContext,
  ChannelOutboundPayloadContext,
  OutboundDeliveryResult,
} from '@xopcai/xopcbot/channels/plugin-types.js';
import type { OutboundMessage } from '@xopcai/xopcbot/channels/transport-types.js';

import { toRawIlinkUserIdForApi } from './auth/weixin-account-id.js';
import { sendTyping } from './api/api.js';
import { TypingStatus } from './api/types.js';
import { assertSessionActive } from './api/session-guard.js';
import {
  listWeixinAccountIds,
  resolveWeixinAccount,
  type ResolvedWeixinAccount,
} from './auth/accounts.js';
import { downloadRemoteImageToTemp } from './cdn/upload.js';
import { ensureWeixinContextTokenForOutbound } from './messaging/context-token-bootstrap.js';
import {
  findAccountIdsByContextToken,
  findContextTokenEntriesByPeer,
  getContextToken,
  getWeixinOutboundSendUserId,
  tryHydrateAnyAccountContextTokenFromDisk,
} from './messaging/inbound.js';
import { mapWeixinOutboundErrorNotice, sendWeixinErrorNotice } from './messaging/error-notice.js';
import { StreamingMarkdownFilter } from './messaging/markdown-filter.js';
import { parseDataUrl, writeDataUrlBufferToTemp } from './media/data-url.js';
import { markdownToPlainText, sendMessageWeixin } from './messaging/send.js';
import { sendWeixinMediaFile } from './messaging/send-media.js';
import { getWeixinTypingTicket } from './messaging/typing-ticket-store.js';
import { logger } from './util/logger.js';
import { resolveWeixinRootDir } from './storage/state-dir.js';

const MEDIA_OUTBOUND_TEMP_DIR = path.join(resolveWeixinRootDir(), 'media', 'outbound-temp');

/**
 * Weixin ilink text items are plain text (no client-side markdown).
 * Apply StreamingMarkdownFilter (openclaw-weixin), then strip remaining markdown to plain text.
 */
export function formatWeixinOutboundText(text: string): string {
  const f = new StreamingMarkdownFilter();
  const filtered = f.feed(text) + f.flush();
  return markdownToPlainText(filtered);
}

function isLocalFilePath(mediaUrl: string): boolean {
  if (mediaUrl.startsWith('data:')) return false;
  return !mediaUrl.includes('://');
}

function isRemoteUrl(mediaUrl: string): boolean {
  return mediaUrl.startsWith('http://') || mediaUrl.startsWith('https://');
}

function resolveLocalPath(mediaUrl: string): string {
  if (mediaUrl.startsWith('file://')) return new URL(mediaUrl).pathname;
  if (!path.isAbsolute(mediaUrl)) return path.resolve(mediaUrl);
  return mediaUrl;
}

function resolveOutboundAccountId(cfg: Config, to: string, explicit?: string | null): string {
  if (explicit?.trim()) return explicit.trim();
  const allIds = listWeixinAccountIds(cfg);
  if (allIds.length === 0) {
    throw new Error('weixin: no accounts — complete QR login for Weixin first');
  }
  if (allIds.length === 1) return allIds[0];
  const matched = findAccountIdsByContextToken(allIds, to);
  if (matched.length === 1) return matched[0];
  if (matched.length > 1) {
    throw new Error(
      `weixin: ambiguous account for to=${to}; set delivery.accountId in cron or tool calls.`,
    );
  }
  throw new Error(
    `weixin: cannot pick account for to=${to}; specify accountId or ensure an active session with this user.`,
  );
}

type WeixinOutboundPrepared =
  | { ok: true; accountId: string; account: ResolvedWeixinAccount; ctxTok: string | undefined }
  | { ok: false; error: string };

const MISSING_WEIXIN_CONTEXT_TOKEN =
  'weixin: missing context_token for this user — set cron delivery.to to "{accountId}:dm:{ilinkUserId}", ensure the user has messaged this bot recently, or restart after a fresh inbound so the token is cached.';

const AMBIGUOUS_WEIXIN_CONTEXT_TOKEN =
  'weixin: multiple bot accounts have a context_token for this user; set cron delivery.to to "{accountId}:dm:{ilinkUserId}" or metadata.accountId.';

async function resolveWeixinSendContext(
  ctx: ChannelOutboundContext,
): Promise<
  | { ok: true; account: ResolvedWeixinAccount; ctxTok: string; ilinkToUserId: string }
  | { ok: false; error: string }
> {
  const prep = prepareWeixinOutboundSend(ctx);
  if (prep.ok === false) return { ok: false, error: prep.error };

  let account = prep.account;
  let ctxTok = prep.ctxTok?.trim() || undefined;

  if (!ctxTok) {
    for (const aid of listWeixinAccountIds(ctx.cfg)) {
      let a: ResolvedWeixinAccount;
      try {
        a = resolveWeixinAccount(ctx.cfg, aid);
      } catch {
        continue;
      }
      if (!a.configured || !a.token) continue;
      try {
        assertSessionActive(a.accountId);
      } catch {
        continue;
      }
      const t = getContextToken(a.accountId, ctx.to);
      if (t?.trim()) {
        ctxTok = t;
        account = a;
        break;
      }
    }
  }

  if (!ctxTok) {
    const entries = findContextTokenEntriesByPeer(ctx.to);
    const uniqueAccounts = [...new Set(entries.map((e) => e.accountId))];
    if (uniqueAccounts.length > 1) {
      return { ok: false, error: AMBIGUOUS_WEIXIN_CONTEXT_TOKEN };
    }
    if (entries.length >= 1 && uniqueAccounts.length === 1) {
      const { accountId: aid, token } = entries[0]!;
      if (token?.trim()) {
        try {
          const a = resolveWeixinAccount(ctx.cfg, aid);
          assertSessionActive(a.accountId);
          if (a.configured && a.token) {
            account = a;
            ctxTok = token;
          }
        } catch {
          /* keep searching */
        }
      }
    }
  }

  if (!ctxTok?.trim()) {
    const diskHit = tryHydrateAnyAccountContextTokenFromDisk(ctx.to);
    if (diskHit?.token?.trim()) {
      try {
        const a = resolveWeixinAccount(ctx.cfg, diskHit.accountId);
        assertSessionActive(a.accountId);
        if (a.configured && a.token) {
          account = a;
          ctxTok = diskHit.token;
        }
      } catch {
        /* */
      }
    }
  }

  if (!ctxTok?.trim()) {
    ctxTok =
      (await ensureWeixinContextTokenForOutbound(account.accountId, ctx.to, account))?.trim() ||
      undefined;
  }

  if (!ctxTok?.trim()) {
    return { ok: false, error: MISSING_WEIXIN_CONTEXT_TOKEN };
  }

  const ilinkToUserId =
    getWeixinOutboundSendUserId(account.accountId, ctx.to)?.trim() ||
    toRawIlinkUserIdForApi(ctx.to);

  return { ok: true, account, ctxTok, ilinkToUserId };
}

/** Resolve account + session without throwing so ChannelManager can ack durable queue items. */
function prepareWeixinOutboundSend(ctx: ChannelOutboundContext): WeixinOutboundPrepared {
  let accountId: string;
  try {
    accountId = resolveOutboundAccountId(ctx.cfg, ctx.to, ctx.accountId);
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : String(e) };
  }
  let account: ResolvedWeixinAccount;
  try {
    account = resolveWeixinAccount(ctx.cfg, accountId);
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : String(e) };
  }
  try {
    assertSessionActive(account.accountId);
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : String(e) };
  }
  if (!account.configured || !account.token) {
    return { ok: false, error: 'weixin not logged in' };
  }
  const ctxTok = getContextToken(account.accountId, ctx.to);
  return { ok: true, accountId: account.accountId, account, ctxTok };
}

async function sendWeixinTypingIndicator(
  ctx: ChannelOutboundContext,
  mode: 'on' | 'off',
): Promise<OutboundDeliveryResult> {
  try {
    const accountId = resolveOutboundAccountId(ctx.cfg, ctx.to, ctx.accountId);
    const account = resolveWeixinAccount(ctx.cfg, accountId);
    assertSessionActive(account.accountId);
    if (!account.configured || !account.token) {
      return { messageId: '', chatId: ctx.to, success: true };
    }
    const ticket = getWeixinTypingTicket(account.accountId, ctx.to);
    if (!ticket) {
      return { messageId: '', chatId: ctx.to, success: true };
    }
    const typingTo =
      getWeixinOutboundSendUserId(account.accountId, ctx.to)?.trim() ||
      toRawIlinkUserIdForApi(ctx.to);
    await sendTyping({
      baseUrl: account.baseUrl,
      token: account.token,
      routeTag: account.routeTag,
      body: {
        ilink_user_id: typingTo,
        typing_ticket: ticket,
        status: mode === 'on' ? TypingStatus.TYPING : TypingStatus.CANCEL,
      },
    });
    return { messageId: '', chatId: ctx.to, success: true };
  } catch (err) {
    logger.debug(
      { err, to: ctx.to },
      `weixin sendTyping ${mode} skipped or failed (best-effort)`,
    );
    return { messageId: '', chatId: ctx.to, success: true };
  }
}

export function createWeixinOutboundHandlers() {
  const sendTextImpl = async (ctx: ChannelOutboundContext): Promise<OutboundDeliveryResult> => {
    const resolved = await resolveWeixinSendContext(ctx);
    if (resolved.ok === false) {
      return { messageId: '', chatId: ctx.to, success: false, error: resolved.error };
    }
    const { account, ctxTok, ilinkToUserId } = resolved;
    const raw = ctx.text ?? '';
    const text = formatWeixinOutboundText(raw);
    try {
      const r = await sendMessageWeixin({
        to: ctx.to,
        toUserIdForApi: ilinkToUserId,
        text,
        opts: {
          baseUrl: account.baseUrl,
          token: account.token,
          routeTag: account.routeTag,
          contextToken: ctxTok,
        },
      });
      return { messageId: r.messageId, chatId: ctx.to, success: true };
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      logger.error({ err, to: ctx.to }, 'weixin sendText failed');
      void sendWeixinErrorNotice({
        to: ctx.to,
        toUserIdForApi: ilinkToUserId,
        contextToken: ctxTok,
        message: mapWeixinOutboundErrorNotice(msg),
        baseUrl: account.baseUrl,
        token: account.token,
        routeTag: account.routeTag,
        errLog: (m) => logger.warn(m),
      });
      return { messageId: '', chatId: ctx.to, success: false, error: msg };
    }
  };

  const sendMediaImpl = async (ctx: ChannelOutboundContext): Promise<OutboundDeliveryResult> => {
    const resolved = await resolveWeixinSendContext(ctx);
    if (resolved.ok === false) {
      return { messageId: '', chatId: ctx.to, success: false, error: resolved.error };
    }
    const { account, ctxTok, ilinkToUserId } = resolved;
    const mediaUrl = ctx.mediaUrl?.trim();
    if (!mediaUrl) {
      return { messageId: '', chatId: ctx.to, success: false, error: 'No media URL' };
    }
    const caption = formatWeixinOutboundText(ctx.text ?? '');
    try {
      let filePath: string;

      if (mediaUrl.startsWith('data:')) {
        const parsed = parseDataUrl(mediaUrl);
        if (!parsed) {
          return { messageId: '', chatId: ctx.to, success: false, error: 'Invalid data URL' };
        }
        filePath = await writeDataUrlBufferToTemp({
          buffer: parsed.buffer,
          mimeType: parsed.mimeType,
          destDir: MEDIA_OUTBOUND_TEMP_DIR,
        });
      } else if (isLocalFilePath(mediaUrl) || mediaUrl.startsWith('file://')) {
        filePath = resolveLocalPath(mediaUrl);
      } else if (isRemoteUrl(mediaUrl)) {
        filePath = await downloadRemoteImageToTemp(mediaUrl, MEDIA_OUTBOUND_TEMP_DIR);
      } else {
        await sendMessageWeixin({
          to: ctx.to,
          toUserIdForApi: ilinkToUserId,
          text: caption,
          opts: {
            baseUrl: account.baseUrl,
            token: account.token,
            routeTag: account.routeTag,
            contextToken: ctxTok,
          },
        });
        return { messageId: '', chatId: ctx.to, success: true };
      }

      const uploadOpts = {
        baseUrl: account.baseUrl,
        token: account.token,
        routeTag: account.routeTag,
        contextToken: ctxTok,
      };

      /** openclaw-weixin: audio (e.g. TTS mp3) is not VoiceItem — same as other non-image/video files (FILE attachment). */
      const r = await sendWeixinMediaFile({
        filePath,
        to: ctx.to,
        toUserIdForApi: ilinkToUserId,
        text: caption,
        opts: uploadOpts,
        cdnBaseUrl: account.cdnBaseUrl,
      });
      return { messageId: r.messageId, chatId: ctx.to, success: true };
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      logger.error({ err, to: ctx.to }, 'weixin sendMedia failed');
      void sendWeixinErrorNotice({
        to: ctx.to,
        toUserIdForApi: ilinkToUserId,
        contextToken: ctxTok,
        message: mapWeixinOutboundErrorNotice(msg),
        baseUrl: account.baseUrl,
        token: account.token,
        routeTag: account.routeTag,
        errLog: (m) => logger.warn(m),
      });
      return { messageId: '', chatId: ctx.to, success: false, error: msg };
    }
  };

  const sendPayloadImpl = async (
    ctx: ChannelOutboundPayloadContext,
  ): Promise<OutboundDeliveryResult> => {
    const payload = ctx.payload as OutboundMessage;
    if (payload.type === 'typing_on') {
      return sendWeixinTypingIndicator(ctx, 'on');
    }
    if (payload.type === 'typing_off') {
      return sendWeixinTypingIndicator(ctx, 'off');
    }
    const hasMediaUrl = Boolean(ctx.mediaUrl?.trim());
    if (hasMediaUrl) {
      return sendMediaImpl(ctx);
    }
    return sendTextImpl(ctx);
  };

  return {
    sendPayload: sendPayloadImpl,
    sendText: sendTextImpl,
    sendMedia: sendMediaImpl,
  };
}

export function weixinTextChunker(text: string, limit: number): string[] {
  const chunks: string[] = [];
  let i = 0;
  while (i < text.length) {
    chunks.push(text.slice(i, i + limit));
    i += limit;
  }
  return chunks.length ? chunks : [''];
}
