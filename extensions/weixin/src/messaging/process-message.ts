import { mkdir, readFile, unlink, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { randomBytes } from 'node:crypto';

import { persistInboundAttachments } from '@xopcai/xopc/channels/attachments/inbound-persist.js';
import { handleChannelConnectionProbe } from '@xopcai/xopc/channels/connection-probe.js';
import type { Config } from '@xopcai/xopc/config/schema.js';
import type { MessageBus } from '@xopcai/xopc/infra/bus/index.js';
import { issuePairingChallenge, resolveWeixinPairingPath } from '@xopcai/xopc/channels/pairing/index.js';
import { evaluateAccess } from '@xopcai/xopc/channels/security.js';
import type { WeixinMessage } from '../api/types.js';
import { MessageItemType } from '../api/types.js';
import type { ResolvedWeixinAccount } from '../auth/accounts.js';
import { readFrameworkAllowFromList } from '../auth/pairing.js';
import { downloadMediaFromItem } from '../media/media-download.js';
import { logger } from '../util/logger.js';
import { resolveWeixinRootDir } from '../storage/state-dir.js';
import { handleSlashCommand } from './slash-commands.js';
import { sendMessageWeixin } from './send.js';
import {
  setContextToken,
  weixinMessageToMsgContext,
  isMediaItem,
} from './inbound.js';
import { getWeixinQuotedMessage, rememberWeixinQuotedMessage } from './quote-cache.js';
import { isDebugMode } from './debug-mode.js';
import { generateWeixinConversationIdWithRouting } from '../routing-integration.js';

function extractTextBody(itemList?: import('../api/types.js').MessageItem[]): string {
  if (!itemList?.length) return '';
  for (const item of itemList) {
    if (item.type === MessageItemType.TEXT && item.text_item?.text != null) {
      return String(item.text_item.text);
    }
  }
  return '';
}

function mergeAllowFrom(account: ResolvedWeixinAccount, accountId: string): string[] {
  const store = readFrameworkAllowFromList(accountId);
  return [...new Set([...(account.allowFrom ?? []).map(String), ...store])];
}

async function saveMediaBuffer(
  buffer: Buffer,
  contentType?: string,
  _subdir?: string,
  maxBytes?: number,
  originalFilename?: string,
): Promise<{ path: string }> {
  const cap = Math.min(maxBytes ?? Infinity, 5 * 1024 * 1024);
  if (buffer.length > cap) {
    throw new Error(`weixin media exceeds max bytes (${cap})`);
  }
  const dir = path.join(resolveWeixinRootDir(), 'media', 'inbound-temp');
  await mkdir(dir, { recursive: true });
  const ext = originalFilename ? path.extname(originalFilename) : contentType?.includes('wav') ? '.wav' : '.bin';
  const fname = `${Date.now()}-${randomBytes(6).toString('hex')}${ext || '.bin'}`;
  const filePath = path.join(dir, fname);
  await writeFile(filePath, buffer);
  return { path: filePath };
}

export type ProcessWeixinMessageDeps = {
  accountId: string;
  account: ResolvedWeixinAccount;
  config: Config;
  bus: MessageBus;
  baseUrl: string;
  cdnBaseUrl: string;
  token?: string;
  routeTag?: string;
  delivery?: Parameters<MessageBus['publishInbound']>[1];
  abortSignal?: AbortSignal;
};

export async function processWeixinInboundMessage(
  full: WeixinMessage,
  deps: ProcessWeixinMessageDeps,
): Promise<void> {
  const receivedAt = Date.now();
  const senderId = full.from_user_id ?? '';
  // Persist ilink context_token before slash handling and DM policy. Pairing only gates the agent
  // pipeline; cron/tools still need a cached token to call sendmessage.
  if (full.context_token?.trim() && senderId) {
    setContextToken(deps.accountId, senderId, full.context_token, { sendToUserId: senderId });
  }

  const textBody = extractTextBody(full.item_list);
  if (senderId && full.context_token && await handleChannelConnectionProbe({
    channel: 'weixin', accountId: deps.accountId, senderId, text: textBody,
    reply: text => sendMessageWeixin({
      to: senderId, text,
      opts: { baseUrl: deps.baseUrl, token: deps.token, contextToken: full.context_token, routeTag: deps.routeTag },
    }),
  })) return;

  const mergedAllow = mergeAllowFrom(deps.account, deps.accountId);
  const access = evaluateAccess({
    context: {
      channel: 'weixin',
      accountId: deps.accountId,
      chatId: senderId,
      senderId,
      isGroup: false,
      isDm: true,
    },
    dmPolicy: deps.account.dmPolicy ?? 'open',
    allowFrom: mergedAllow,
  });
  if (!access.allowed) {
    if (access.reason === 'pairing-required' && deps.token) {
      try {
        await issuePairingChallenge({
          channel: 'weixin',
          pairingFilePath: resolveWeixinPairingPath(deps.accountId),
          accountId: deps.accountId,
          senderId,
          senderIdLine: `Your Weixin user id: ${senderId}`,
          sendPairingReply: async (text) => {
            await sendMessageWeixin({
              to: senderId,
              text,
              opts: {
                baseUrl: deps.baseUrl,
                token: deps.token,
                contextToken: full.context_token,
                routeTag: deps.routeTag,
              },
            });
          },
          onReplyError: (err) => {
            logger.warn(`weixin pairing reply failed from=${senderId} err=${String(err)}`);
          },
        });
      } catch (err) {
        logger.warn(`weixin pairing prompt failed from=${senderId} err=${String(err)}`);
      }
    } else {
      logger.info(
        `weixin: dropped message from=${senderId} dmPolicy=${deps.account.dmPolicy ?? 'open'} reason=${access.reason ?? 'not allowed'}`,
      );
    }
    return;
  }

  if (textBody.startsWith('/')) {
    const slashResult = await handleSlashCommand(
      textBody,
      {
        to: full.from_user_id ?? '',
        contextToken: full.context_token,
        baseUrl: deps.baseUrl,
        token: deps.token,
        accountId: deps.accountId,
        log: () => {},
        errLog: () => {},
      },
      receivedAt,
      full.create_time_ms,
    );
    if (slashResult.handled) {
      return;
    }
  }

  const currentAttachments: NonNullable<Parameters<MessageBus['publishInbound']>[0]['attachments']> = [];
  const quotedAttachments: typeof currentAttachments = [];
  const incoming = (full.item_list ?? []).filter(item => isMediaItem(item) && !item.voice_item?.text);
  const quoted = (full.item_list ?? []).flatMap(item => {
    const ref = item.ref_msg?.message_item;
    return ref && isMediaItem(ref) && !ref.voice_item?.text ? [ref] : [];
  });

  let totalBytes = 0;
  for (const [index, item] of [...incoming, ...quoted].slice(0, 8).entries()) {
    deps.abortSignal?.throwIfAborted();
    let savedPath: string | undefined;
    try {
      const media = await downloadMediaFromItem(item, {
        cdnBaseUrl: deps.cdnBaseUrl,
        saveMedia: saveMediaBuffer,
        log: m => logger.debug(m),
        errLog: m => logger.warn(m),
        label: index < incoming.length ? 'inbound' : 'ref',
        signal: deps.abortSignal,
      });
      savedPath = media.decryptedPicPath ?? media.decryptedVoicePath ?? media.decryptedFilePath ?? media.decryptedVideoPath;
      if (!savedPath) continue;
      const type = media.decryptedPicPath ? 'image' : media.decryptedVoicePath ? 'audio' : 'file';
      const mimeType = media.decryptedPicPath ? 'image/jpeg'
        : media.decryptedVoicePath ? media.voiceMediaType ?? 'audio/wav'
        : media.decryptedVideoPath ? 'video/mp4'
        : media.fileMediaType ?? 'application/octet-stream';
      const buffer = await readFile(savedPath);
      if (totalBytes + buffer.length > 20 * 1024 * 1024) break;
      totalBytes += buffer.length;
      const attachments = index < incoming.length ? currentAttachments : quotedAttachments;
      attachments.push({
        type,
        mimeType,
        data: buffer.toString('base64'),
        name: path.basename(savedPath),
      });
    } catch (err) {
      logger.warn({ accountId: deps.accountId, errorType: err instanceof Error ? err.name : typeof err }, 'Weixin attachment could not be prepared');
    } finally {
      if (savedPath) await unlink(savedPath).catch(() => {});
    }
  }

  const ctx = weixinMessageToMsgContext(full, deps.accountId);
  let body = ctx.Body?.trim() ?? '';
  const currentRefs = await persistInboundAttachments(currentAttachments);
  const stableMessageId = full.message_id == null ? undefined : String(full.message_id);
  if (stableMessageId && deps.delivery) {
    rememberWeixinQuotedMessage(deps.delivery.scope, senderId, stableMessageId, textBody || body, currentRefs);
  }
  if (deps.delivery) {
    for (const item of full.item_list ?? []) {
      const ref = item.ref_msg;
      if (!ref?.svr_id || ref.message_item || ref.svr_id === stableMessageId) continue;
      const cached = await getWeixinQuotedMessage(deps.delivery.scope, senderId, ref.svr_id);
      if (!cached) continue;
      if (!ref.title && cached.text) body = `[引用: ${cached.text}]\n${body}`;
      quotedAttachments.push(...cached.attachments);
    }
  }
  const attachments = [...(currentRefs ?? []), ...quotedAttachments];
  const conversationId = generateWeixinConversationIdWithRouting(
    { accountId: deps.accountId, senderId },
    deps.config,
  );

  const debug = isDebugMode(deps.accountId);
  if (debug) {
    logger.debug(
      `weixin debug inbound from=${senderId} bodyLen=${body.length} attachments=${attachments.length}`,
    );
  }

  deps.abortSignal?.throwIfAborted();
  if (!body && !attachments.length) return;
  await deps.bus.publishInbound({
    channel: 'weixin',
    sender_id: senderId,
    chat_id: senderId,
    content: body,
    metadata: {
      accountId: deps.accountId,
      conversationId,
      messageId: full.message_id != null ? String(full.message_id) : undefined,
      isGroup: false,
      isCommand: body.trim().startsWith('/'),
      contextToken: ctx.context_token,
    },
    attachments: attachments.length ? attachments : undefined,
  }, deps.delivery);
}
