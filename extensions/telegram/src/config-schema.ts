import { z } from 'zod';

export const TelegramStreamingBlockCoalesceSchema = z.object({
  minChars: z.number().default(800),
  idleMs: z.number().default(1000),
}).strict();

export const TelegramStreamingPreviewSchema = z.object({
  toolProgress: z.boolean().default(true),
}).strict();

export const TelegramStreamingConfigSchema = z.object({
  mode: z.enum(['off', 'partial', 'block']).default('partial'),
  preview: TelegramStreamingPreviewSchema.optional(),
  block: z
    .object({
      coalesce: TelegramStreamingBlockCoalesceSchema.optional(),
    })
    .strict()
    .optional(),
}).strict();

export const TelegramTopicConfigSchema = z.object({
  topicId: z.string().optional(),
  requireMention: z.boolean().optional(),
  enabled: z.boolean().optional(),
  allowFrom: z.array(z.union([z.string(), z.number()])).optional(),
  systemPrompt: z.string().optional(),
  agentId: z.string().optional(),
}).strict();

export const TelegramGroupConfigSchema = z.object({
  groupId: z.string().optional(),
  requireMention: z.boolean().optional(),
  enabled: z.boolean().optional(),
  allowFrom: z.array(z.union([z.string(), z.number()])).optional(),
  systemPrompt: z.string().optional(),
  agentId: z.string().optional(),
  topics: z.record(z.string(), TelegramTopicConfigSchema).optional(),
}).strict();

export const TelegramActionsConfigSchema = z.object({
  reactions: z.boolean().default(true),
  sendMessage: z.boolean().default(true),
  editMessage: z.boolean().default(true),
  deleteMessage: z.boolean().default(false),
  poll: z.boolean().default(false),
  sticker: z.boolean().default(false),
  createForumTopic: z.boolean().default(false),
}).strict();

export const TelegramExecApprovalsConfigSchema = z.object({
  enabled: z.boolean().default(false),
  approvers: z.array(z.union([z.string(), z.number()])).optional(),
}).strict();

export const TelegramThreadBindingsConfigSchema = z.object({
  enabled: z.boolean().default(false),
  idleTimeoutMs: z.number().optional(),
  maxAgeMs: z.number().optional(),
}).strict();

export const TelegramAccountConfigSchema = z.object({
  accountId: z.string().optional(),
  name: z.string().optional(),
  enabled: z.boolean().default(true),
  botToken: z.string().default(''),
  tokenFile: z.string().optional(),
  allowFrom: z.array(z.union([z.string(), z.number()])).default([]),
  groupAllowFrom: z.array(z.union([z.string(), z.number()])).optional(),
  dmPolicy: z.enum(['pairing', 'allowlist', 'open', 'disabled']).default('pairing'),
  groupPolicy: z.enum(['open', 'disabled', 'allowlist']).default('open'),
  replyToMode: z.enum(['off', 'first', 'all']).default('off'),
  groups: z.record(z.string(), TelegramGroupConfigSchema).optional(),
  historyLimit: z.number().default(50),
  textChunkLimit: z.number().default(4000),
  streaming: TelegramStreamingConfigSchema.optional(),
  proxy: z.string().optional(),
  apiRoot: z.string().optional(),
  pollingStallThresholdMs: z.number().min(30_000).max(600_000).optional(),
  reactionLevel: z.enum(['off', 'ack', 'minimal', 'extensive']).default('ack'),
  reactionNotifications: z.enum(['off', 'own', 'all']).default('own'),
  ackReaction: z.string().optional(),
  actions: TelegramActionsConfigSchema.optional(),
  execApprovals: TelegramExecApprovalsConfigSchema.optional(),
  threadBindings: TelegramThreadBindingsConfigSchema.optional(),
}).strict();

export const TelegramConfigSchema = z.object({
  enabled: z.boolean().default(false),
  allowFrom: z.array(z.union([z.string(), z.number()])).default([]),
  groupAllowFrom: z.array(z.union([z.string(), z.number()])).default([]),
  apiRoot: z.string().optional(),
  debug: z.boolean().default(false),
  accounts: z.record(z.string(), TelegramAccountConfigSchema).optional(),
  dmPolicy: z.enum(['pairing', 'allowlist', 'open', 'disabled']).default('pairing'),
  groupPolicy: z.enum(['open', 'disabled', 'allowlist']).default('open'),
  replyToMode: z.enum(['off', 'first', 'all']).default('off'),
  streaming: TelegramStreamingConfigSchema.optional(),
  historyLimit: z.number().default(50),
  textChunkLimit: z.number().default(4000),
  proxy: z.string().optional(),
}).strict();

export type TelegramConfig = z.infer<typeof TelegramConfigSchema>;
export type TelegramStreamingConfig = z.infer<typeof TelegramStreamingConfigSchema>;

/** Resolve effective streaming mode for an account. */
export function resolveTelegramStreamingMode(account: {
  streaming?: { mode?: 'off' | 'partial' | 'block' };
}): 'off' | 'partial' | 'block' {
  return account.streaming?.mode ?? 'partial';
}
