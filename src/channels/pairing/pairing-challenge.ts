import { buildPairingInstructionText } from './pairing-messages.js';
import { broadcastPairingEvent } from './pairing-events.js';
import { upsertPairingRequestSync } from './pairing-store.js';

import type { PairingCliChannel } from './pairing-channel.js';

export type IssuePairingChallengeParams = {
  channel: PairingCliChannel;
  pairingFilePath: string;
  accountId: string;
  senderId: string;
  senderIdLine: string;
  meta?: Record<string, string | undefined | null>;
  sendPairingReply: (text: string) => Promise<void>;
  buildReplyText?: (p: { code: string; senderIdLine: string }) => string;
  onCreated?: (p: { code: string }) => void;
  onReplyError?: (err: unknown) => void;
};

/**
 * OpenClaw-style pairing: mint or refresh a pending code; notify the user only on new codes.
 * Repeat DMs refresh lastSeenAt and broadcast SSE without re-sending the bot message.
 */
export async function issuePairingChallenge(params: IssuePairingChallengeParams): Promise<{
  created: boolean;
  code?: string;
}> {
  const normalizedAccountId = params.accountId.trim().toLowerCase() || 'default';
  const { code, created } = upsertPairingRequestSync({
    pairingFilePath: params.pairingFilePath,
    id: params.senderId,
    accountId: params.accountId,
    meta: params.meta,
  });
  const broadcastPayload = {
    channel: params.channel,
    accountId: normalizedAccountId,
    senderId: params.senderId,
  };
  if (!created) {
    if (code) {
      broadcastPairingEvent('channels.pairing.refreshed', broadcastPayload);
    }
    return { created: false, code: code || undefined };
  }
  if (!code) {
    return { created: false };
  }
  params.onCreated?.({ code });
  broadcastPairingEvent('channels.pairing.requested', broadcastPayload);
  const replyText =
    params.buildReplyText?.({ code, senderIdLine: params.senderIdLine }) ??
    buildPairingInstructionText({
      channel: params.channel,
      accountId: params.accountId,
      code,
      senderIdLine: params.senderIdLine,
    });
  try {
    await params.sendPairingReply(replyText);
  } catch (err) {
    params.onReplyError?.(err);
  }
  return { created: true, code };
}
