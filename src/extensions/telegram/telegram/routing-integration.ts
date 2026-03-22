/**
 * Telegram Routing Integration
 * 
 * Integrates Telegram channel with the new session routing system.
 * Provides session key generation with routing context.
 */

import type { Context } from 'grammy';
import type { Config } from '../../../config/schema.js';
import {
  buildSessionKey,
  resolveRoute,
  applyIdentityLinks,
  type RouteContext,
} from '../../../routing/index.js';
import { createLogger } from '../../../utils/logger.js';

const log = createLogger('TelegramRouting');

export interface TelegramRoutingContext {
  accountId: string;
  chatId: string;
  senderId: string;
  senderUsername?: string;
  isGroup: boolean;
  threadId?: string;
  guildId?: string;
  memberRoleIds?: string[];
  /**
   * Channel type for identity links.
   * @default 'telegram'
   */
  channel?: string;
}

/**
 * Generate session key with routing integration
 */
export function generateSessionKeyWithRouting(
  ctx: TelegramRoutingContext,
  config: Config
): string {
  const channel = ctx.channel ?? 'telegram';
  
  // Build route context for resolveRoute
  const routeInput: RouteContext = {
    channel,
    accountId: ctx.accountId,
    peerKind: ctx.isGroup ? 'group' : 'dm',
    peerId: ctx.isGroup ? ctx.chatId : ctx.senderId,
    guildId: ctx.guildId ?? null,
    teamId: null,
    memberRoleIds: ctx.memberRoleIds ?? [],
  };

  // Resolve route using bindings
  const route = resolveRoute({
    config,
    ...routeInput,
    threadId: ctx.threadId,
  });

  // Apply identity links for cross-platform user merging
  const identityLinks = config.session?.identityLinks ?? {};
  const originalPeerId = ctx.isGroup ? ctx.chatId : ctx.senderId;
  const finalPeerId = applyIdentityLinks(
    originalPeerId,
    channel,
    identityLinks
  );
  
  // Rebuild session key with final peerId
  const finalSessionKey = buildSessionKey({
    agentId: route.agentId,
    source: channel,
    accountId: route.accountId,
    peerKind: ctx.isGroup ? 'group' : 'dm',
    peerId: finalPeerId,
    threadId: ctx.threadId,
  });

  log.debug({
    accountId: ctx.accountId,
    chatId: ctx.chatId,
    senderId: ctx.senderId,
    sessionKey: finalSessionKey,
    agentId: route.agentId,
  }, 'Generated session key with routing');

  return finalSessionKey;
}

/**
 * Extract member role IDs from Telegram chat member
 * (Currently returns empty array as Telegram doesn't have direct role mapping)
 */
export function extractMemberRoleIds(ctx: Context): string[] {
  // Telegram doesn't have a direct role system like Discord
  // Could implement custom role mapping based on admin status
  const chatMember = ctx.chatMember;
  if (!chatMember?.new_chat_member) {
    return [];
  }

  const roles: string[] = [];
  const memberStatus = chatMember.new_chat_member.status;
  
  if (memberStatus === 'creator') {
    roles.push('telegram:creator');
  } else if (memberStatus === 'administrator') {
    roles.push('telegram:admin');
  }
  
  return roles;
}
