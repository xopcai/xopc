import type { PersonalProactivitySettings } from '@xopcai/gateway-contract';

import { AgentCatalogRepository } from '../../agent-catalog/repository.js';
import type { Config } from '../../config/schema.js';
import { DurableState } from '../../storage/sqlite/durable-state.js';
import { getSqliteDatabase } from '../../storage/sqlite/transaction.js';
import { resolveUserContextSessionAccess } from '../../user-context/access-policy.js';
import { personalConversationState } from '../conversation-state.js';
import { getPersonalAgentByConversation } from '../repository.js';
import { getProactivitySettings, isQuiet, localDay } from './repository.js';

export const INFERRED_PROACTIVE_MESSAGES_NAMESPACE = 'personal-proactivity-messages';

export type ProactiveDeliveryAuthority = 'user_explicit' | 'inferred';

export type ProactiveDeliveryBlockReason =
  | 'stopped'
  | 'personal_unavailable'
  | 'conversation_busy'
  | 'mode_off'
  | 'quiet_hours'
  | 'follow_up_mode_blocks_inferred'
  | 'daily_quota_exhausted';

export type ProactiveDeliveryGateResult =
  | { allowed: true; settings: PersonalProactivitySettings }
  | { allowed: false; reason: ProactiveDeliveryBlockReason; settings: PersonalProactivitySettings };

export interface ProactiveDeliveryGateParams {
  ownerId: string;
  conversationId: string;
  authority: ProactiveDeliveryAuthority;
  config: Config;
  isAvailable: (conversationId: string) => boolean;
  now: number;
  stopped?: boolean;
}

export function isPersonalProactiveAccessible(config: Config, conversationId: string): boolean {
  const access = resolveUserContextSessionAccess(config, conversationId);
  const personal = getPersonalAgentByConversation(conversationId);
  const agent = personal ? new AgentCatalogRepository().get(personal.agentId) : undefined;
  if (!personal || personal.conversationId !== conversationId || personal.state !== 'ready' || agent?.enabled === false) {
    return false;
  }
  return access.userModel
    && config.userContext.userModel.writePolicy !== 'deny'
    && config.userContext.userModel.processingPolicy !== 'local_only';
}

export function isPersonalConversationDeliverable(
  config: Config,
  conversationId: string,
  isAvailable: (conversationId: string) => boolean,
  stopped = false,
): boolean {
  if (stopped || !isPersonalProactiveAccessible(config, conversationId)) {
    return false;
  }
  if (!personalConversationState(conversationId).idle || !isAvailable(conversationId)) {
    return false;
  }
  const activeTaskReply = getSqliteDatabase().prepare(`
    SELECT 1
    FROM task_result_deliveries
    WHERE conversation_id = ?
      AND reply_status IN ('pending', 'generating', 'ready')
      AND reply_attempts < 8
    LIMIT 1
  `).get(conversationId);
  return !activeTaskReply;
}

export function getUsedInferredDailyMessages(
  ownerId: string,
  now: number,
  settings: PersonalProactivitySettings = getProactivitySettings(ownerId),
): number {
  const budget = new DurableState<number>(INFERRED_PROACTIVE_MESSAGES_NAMESPACE, ownerId);
  const day = localDay(now, settings.timezone);
  return budget.get(day) ?? 0;
}

export function getRemainingInferredDailyMessages(
  ownerId: string,
  now: number,
  settings: PersonalProactivitySettings = getProactivitySettings(ownerId),
): number {
  return Math.max(0, settings.dailyMessages - getUsedInferredDailyMessages(ownerId, now, settings));
}

/**
 * Unified proactive delivery gate shared by PersonalProactivityService and ProactiveHubService.
 * Explicit delegations ('user_explicit' / 'one_shot') pass 'follow_up' mode and do not consume
 * inferred daily quota; all inferred sources ('inferred', including Hub Tier-S chat escalations)
 * are blocked in 'follow_up' mode and share a single daily quota counter.
 */
export class ProactiveDeliveryGovernor {
  check(params: ProactiveDeliveryGateParams): ProactiveDeliveryGateResult {
    const settings = getProactivitySettings(params.ownerId);
    if (params.stopped) {
      return { allowed: false, reason: 'stopped', settings };
    }
    if (settings.mode === 'off') {
      return { allowed: false, reason: 'mode_off', settings };
    }
    if (isQuiet(params.now, settings)) {
      return { allowed: false, reason: 'quiet_hours', settings };
    }
    if (params.authority === 'inferred' && settings.mode === 'follow_up') {
      return { allowed: false, reason: 'follow_up_mode_blocks_inferred', settings };
    }
    if (!isPersonalProactiveAccessible(params.config, params.conversationId)) {
      return { allowed: false, reason: 'personal_unavailable', settings };
    }
    if (!isPersonalConversationDeliverable(params.config, params.conversationId, params.isAvailable, params.stopped)) {
      return { allowed: false, reason: 'conversation_busy', settings };
    }
    if (params.authority === 'inferred' && getUsedInferredDailyMessages(params.ownerId, params.now, settings) >= settings.dailyMessages) {
      return { allowed: false, reason: 'daily_quota_exhausted', settings };
    }
    return { allowed: true, settings };
  }

  /**
   * Re-validates delivery eligibility and atomically reserves 1 daily inferred message slot
   * when authority === 'inferred'. Must be called inside the publish SQLite write transaction.
   */
  tryReserveSlot(params: ProactiveDeliveryGateParams): ProactiveDeliveryGateResult {
    const checkResult = this.check(params);
    if (!checkResult.allowed) {
      return checkResult;
    }
    if (params.authority === 'inferred') {
      const budget = new DurableState<number>(INFERRED_PROACTIVE_MESSAGES_NAMESPACE, params.ownerId);
      const day = localDay(params.now, checkResult.settings.timezone);
      const used = budget.get(day) ?? 0;
      if (used >= checkResult.settings.dailyMessages) {
        return { allowed: false, reason: 'daily_quota_exhausted', settings: checkResult.settings };
      }
      budget.set(day, used + 1);
      for (const [oldDay] of budget.entries()) {
        if (oldDay !== day) budget.delete(oldDay);
      }
    }
    return checkResult;
  }
}

export const proactiveDeliveryGovernor = new ProactiveDeliveryGovernor();
