import type { TelegramAccountConfig, TelegramGroupConfig, TelegramTopicConfig } from '@xopcai/xopc/channels/channel-domain.js';

export interface ResolvedTelegramGroupContext {
  groupConfig?: TelegramGroupConfig;
  topicConfig?: TelegramTopicConfig;
  systemPrompt?: string;
  agentId?: string;
}

export function resolveTelegramGroupContext(params: {
  account: TelegramAccountConfig;
  chatId: string;
  threadId?: string | number;
}): ResolvedTelegramGroupContext {
  const chatKey = params.chatId;
  const threadKey = params.threadId != null ? String(params.threadId) : undefined;
  const groupConfig = params.account.groups?.[chatKey];
  const topicConfig = threadKey ? groupConfig?.topics?.[threadKey] : undefined;

  const systemPrompt = topicConfig?.systemPrompt?.trim() || groupConfig?.systemPrompt?.trim() || undefined;
  const agentId = topicConfig?.agentId?.trim() || groupConfig?.agentId?.trim() || undefined;

  return { groupConfig, topicConfig, systemPrompt, agentId };
}
