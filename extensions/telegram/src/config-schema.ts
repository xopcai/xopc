import { z } from 'zod';

export const TelegramTopicConfigSchema = z.object({
  topicId: z.string(),
  requireMention: z.boolean().optional(),
  enabled: z.boolean().optional(),
  allowFrom: z.array(z.union([z.string(), z.number()])).optional(),
  systemPrompt: z.string().optional(),
});

export const TelegramGroupConfigSchema = z.object({
  groupId: z.string(),
  requireMention: z.boolean().optional(),
  enabled: z.boolean().optional(),
  allowFrom: z.array(z.union([z.string(), z.number()])).optional(),
  systemPrompt: z.string().optional(),
  topics: z.record(z.string(), TelegramTopicConfigSchema).optional(),
});

export const TelegramAccountConfigSchema = z.object({
  accountId: z.string(),
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
  streamMode: z.enum(['off', 'partial', 'block']).default('partial'),
  proxy: z.string().optional(),
  apiRoot: z.string().optional(),
});

/** Implicit enable when `botToken` is set. */
function preprocessTelegramConfigInput(raw: unknown): unknown {
  if (raw === null || raw === undefined) return raw;
  if (typeof raw !== 'object' || Array.isArray(raw)) return raw;
  const o = { ...(raw as Record<string, unknown>) };
  const botToken = typeof o.botToken === 'string' ? o.botToken : '';
  if (o.enabled === undefined && botToken.trim().length > 0) {
    o.enabled = true;
  }
  return o;
}

const TelegramConfigSchemaInner = z.object({
  enabled: z.boolean().default(false),
  botToken: z.string().default(''),
  allowFrom: z.array(z.union([z.string(), z.number()])).default([]),
  groupAllowFrom: z.array(z.union([z.string(), z.number()])).default([]),
  apiRoot: z.string().optional(),
  debug: z.boolean().default(false),
  accounts: z.record(z.string(), TelegramAccountConfigSchema).optional(),
  dmPolicy: z.enum(['pairing', 'allowlist', 'open', 'disabled']).default('pairing'),
  groupPolicy: z.enum(['open', 'disabled', 'allowlist']).default('open'),
  replyToMode: z.enum(['off', 'first', 'all']).default('off'),
  streamMode: z.enum(['off', 'partial', 'block']).optional(),
  historyLimit: z.number().default(50),
  textChunkLimit: z.number().default(4000),
  proxy: z.string().optional(),
});

export const TelegramConfigSchema = z.preprocess(preprocessTelegramConfigInput, TelegramConfigSchemaInner);

export type TelegramConfig = z.infer<typeof TelegramConfigSchema>;
