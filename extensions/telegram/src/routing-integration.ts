/**
 * Telegram Routing Integration
 * 
 * Integrates Telegram channel with the new session routing system.
 * Provides session key generation with routing context.
 */

import type { Context } from 'grammy';
import type { Config } from '@xopcai/xopc/config/schema.js';
import {
  resolveRoute,
  type RouteContext,
} from '@xopcai/xopc/routing/index.js';
import { createLogger } from '@xopcai/xopc/utils/logger.js';

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
export function generateConversationIdWithRouting(
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
    config: { ...config, session: { ...config.session, dmScope: 'per-account-channel-peer' } },
    ...routeInput,
    threadId: ctx.threadId,
  });

  const finalConversationId = route.conversationId;

  log.debug({
    accountId: ctx.accountId,
    chatId: ctx.chatId,
    senderId: ctx.senderId,
    conversationId: finalConversationId,
    agentId: route.agentId,
  }, 'Generated session key with routing');

  return finalConversationId;
}

/**
 * Extract member role IDs from Telegram chat member
 * (Currently returns empty array as Telegram doesn't have direct role mapping)
 */
export function extractMemberRoleIds(ctx: Context): string[] {
  // Telegram doesn't expose a first-class role id list like some other chat APIs
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
