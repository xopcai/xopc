import type { Config } from '../config/schema.js';
import type { SessionListReader } from '../session/store-reader.js';
import {
  inspectWeixinChannelState,
  listDeliverableWeixinTargets,
} from './weixin/outbound-targets.js';

export type CrossChannelTargetCandidate = {
  accountId?: string;
  chatId: string;
};

export type CrossChannelTargetResolution =
  | {
      ok: true;
      channel: string;
      chatId: string;
      accountId?: string;
    }
  | {
      ok: false;
      reason: 'not_configured' | 'no_recipient' | 'ambiguous';
      message: string;
      candidates?: CrossChannelTargetCandidate[];
    };

function formatCandidates(candidates: CrossChannelTargetCandidate[]): string {
  return candidates
    .slice(0, 10)
    .map((c) => (c.accountId ? `${c.chatId} (accountId: ${c.accountId})` : c.chatId))
    .join(', ');
}

function isChannelEnabledInConfig(config: Config | undefined, channel: string): boolean {
  const section = config?.channels?.[channel as keyof NonNullable<Config['channels']>] as
    | { enabled?: boolean }
    | undefined;
  return section?.enabled === true;
}

/**
 * Resolve a single unambiguous default recipient for a proactive cross-channel
 * send when the caller omitted `chat_id` in an authorized owner conversation.
 */
export async function resolveDefaultCrossChannelTarget(params: {
  channel: string;
  accountId?: string;
  config?: Config;
  sessionStore?: SessionListReader;
}): Promise<CrossChannelTargetResolution> {
  const channel = params.channel.trim().toLowerCase();
  const requestedAccountId = params.accountId?.trim() || undefined;
  const { config, sessionStore } = params;

  if (!config || !isChannelEnabledInConfig(config, channel)) {
    return {
      ok: false,
      reason: 'not_configured',
      message: `Channel "${channel}" is not enabled in configuration.`,
    };
  }

  if (channel === 'weixin') {
    const state = inspectWeixinChannelState(config);
    if (!state.hasCredential) {
      return {
        ok: false,
        reason: 'not_configured',
        message: 'Weixin channel is enabled, but no Weixin account is logged in yet. Complete QR login in Channels first.',
      };
    }

    const targets = listDeliverableWeixinTargets(config, requestedAccountId);
    if (targets.length === 1) {
      const target = targets[0]!;
      return {
        ok: true,
        channel: 'weixin',
        chatId: target.chatId,
        accountId: target.accountId,
      };
    }
    if (targets.length > 1) {
      return {
        ok: false,
        reason: 'ambiguous',
        candidates: targets,
        message: `Multiple deliverable Weixin recipients exist. Specify chat_id (and accountId if needed): ${formatCandidates(targets)}.`,
      };
    }
    return {
      ok: false,
      reason: 'no_recipient',
      message: requestedAccountId
        ? `No deliverable Weixin recipient with an active context_token was found for account "${requestedAccountId}". Ask the user to send a message to the Weixin bot first.`
        : 'No deliverable Weixin recipient with an active context_token was found. Ask the user to send a message to the Weixin bot first.',
    };
  }

  if (sessionStore) {
    const batch = await sessionStore.list({ channel, limit: 50, sortBy: 'updatedAt', sortOrder: 'desc' });
    const seen = new Set<string>();
    const candidates: CrossChannelTargetCandidate[] = [];
    for (const session of batch.items) {
      const routing = session.routing;
      if (!routing || (routing.peerKind !== 'direct' && routing.peerKind !== 'dm')) continue;
      const peerId = routing.peerId?.trim();
      if (!peerId) continue;
      const acct = routing.accountId && routing.accountId !== '_' ? routing.accountId.trim() : undefined;
      if (requestedAccountId && acct !== requestedAccountId) continue;
      const dedupeKey = `${acct ?? ''}:${peerId.toLowerCase()}`;
      if (seen.has(dedupeKey)) continue;
      seen.add(dedupeKey);
      candidates.push({ chatId: peerId, ...(acct ? { accountId: acct } : {}) });
    }
    if (candidates.length === 1) {
      const target = candidates[0]!;
      return {
        ok: true,
        channel,
        chatId: target.chatId,
        ...(target.accountId ? { accountId: target.accountId } : {}),
      };
    }
    if (candidates.length > 1) {
      return {
        ok: false,
        reason: 'ambiguous',
        candidates,
        message: `Multiple recent direct-message recipients exist for "${channel}". Specify chat_id explicitly: ${formatCandidates(candidates)}.`,
      };
    }
  }

  return {
    ok: false,
    reason: 'no_recipient',
    message: `No default recipient found for channel "${channel}". Provide chat_id explicitly or have the user message the bot on "${channel}" first.`,
  };
}
