import { z } from 'zod';

export const TelegramStreamingBlockCoalesceSchema = z.object({
  minChars: z.number().default(800),
  idleMs: z.number().default(1000),
});

export const TelegramStreamingPreviewSchema = z.object({
  toolProgress: z.boolean().default(true),
});

export const TelegramStreamingConfigSchema = z.object({
  mode: z.enum(['off', 'partial', 'block', 'progress']).default('partial'),
  preview: TelegramStreamingPreviewSchema.optional(),
  block: z
    .object({
      coalesce: TelegramStreamingBlockCoalesceSchema.optional(),
    })
    .optional(),
});

export const TelegramTopicConfigSchema = z.object({
  topicId: z.string(),
  requireMention: z.boolean().optional(),
  enabled: z.boolean().optional(),
  allowFrom: z.array(z.union([z.string(), z.number()])).optional(),
  systemPrompt: z.string().optional(),
  agentId: z.string().optional(),
});

export const TelegramGroupConfigSchema = z.object({
  groupId: z.string(),
  requireMention: z.boolean().optional(),
  enabled: z.boolean().optional(),
  allowFrom: z.array(z.union([z.string(), z.number()])).optional(),
  systemPrompt: z.string().optional(),
  agentId: z.string().optional(),
  topics: z.record(z.string(), TelegramTopicConfigSchema).optional(),
});

export const TelegramActionsConfigSchema = z.object({
  reactions: z.boolean().default(true),
  sendMessage: z.boolean().default(true),
  editMessage: z.boolean().default(true),
  deleteMessage: z.boolean().default(false),
  poll: z.boolean().default(false),
  sticker: z.boolean().default(false),
  createForumTopic: z.boolean().default(false),
});

export const TelegramExecApprovalsConfigSchema = z.object({
  enabled: z.boolean().default(false),
  approvers: z.array(z.union([z.string(), z.number()])).optional(),
});

export const TelegramThreadBindingsConfigSchema = z.object({
  enabled: z.boolean().default(false),
  idleTimeoutMs: z.number().optional(),
  maxAgeMs: z.number().optional(),
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
  streamMode: z.enum(['off', 'partial', 'block']).optional(),
  streaming: TelegramStreamingConfigSchema.optional(),
  proxy: z.string().optional(),
  apiRoot: z.string().optional(),
  pollingStallThresholdMs: z.number().min(30_000).max(600_000).optional(),
  reactionLevel: z.enum(['off', 'ack', 'minimal', 'extensive']).default('ack'),
  reactionNotifications: z.enum(['off', 'own', 'all']).default('own'),
  ackReaction: z.string().optional(),
  webhookUrl: z.string().optional(),
  webhookSecret: z.string().optional(),
  webhookPath: z.string().optional(),
  actions: TelegramActionsConfigSchema.optional(),
  execApprovals: TelegramExecApprovalsConfigSchema.optional(),
  threadBindings: TelegramThreadBindingsConfigSchema.optional(),
});

function migrateStreamModeToStreaming(record: Record<string, unknown>): void {
  if (record.streaming && typeof record.streaming === 'object') return;
  const legacy = record.streamMode;
  if (typeof legacy !== 'string') return;
  const mode =
    legacy === 'block' ? 'block' : legacy === 'off' ? 'off' : legacy === 'partial' ? 'partial' : 'partial';
  record.streaming = { mode, preview: { toolProgress: true } };
}

function preprocessAccountRecord(record: Record<string, unknown>): void {
  migrateStreamModeToStreaming(record);
}

/** Migrate legacy top-level `botToken` into `accounts.default`; implicit enable when token is set. */
function preprocessTelegramConfigInput(raw: unknown): unknown {
  if (raw === null || raw === undefined) return raw;
  if (typeof raw !== 'object' || Array.isArray(raw)) return raw;
  const o = { ...(raw as Record<string, unknown>) };

  const legacyToken = typeof o.botToken === 'string' ? o.botToken.trim() : '';
  if (legacyToken) {
    const prev =
      o.accounts && typeof o.accounts === 'object' && !Array.isArray(o.accounts)
        ? (o.accounts as Record<string, unknown>)
        : {};
    const acc = { ...prev };
    const rawDef = acc.default;
    const def =
      rawDef && typeof rawDef === 'object' && !Array.isArray(rawDef)
        ? { ...(rawDef as Record<string, unknown>) }
        : {};
    const defToken = typeof def.botToken === 'string' ? def.botToken.trim() : '';
    if (!defToken) {
      acc.default = { ...def, accountId: 'default', botToken: legacyToken };
    }
    o.accounts = acc;
  }
  delete o.botToken;

  migrateStreamModeToStreaming(o);

  const accounts = o.accounts as Record<string, Record<string, unknown>> | undefined;
  if (accounts) {
    for (const acc of Object.values(accounts)) {
      if (acc && typeof acc === 'object') {
        preprocessAccountRecord(acc);
      }
    }
  }

  const defaultAcc = accounts?.default;
  const token =
    defaultAcc && typeof defaultAcc === 'object' && typeof defaultAcc.botToken === 'string'
      ? defaultAcc.botToken
      : '';
  if (o.enabled === undefined && token.trim().length > 0) {
    o.enabled = true;
  }
  return o;
}

const TelegramConfigSchemaInner = z.object({
  enabled: z.boolean().default(false),
  allowFrom: z.array(z.union([z.string(), z.number()])).default([]),
  groupAllowFrom: z.array(z.union([z.string(), z.number()])).default([]),
  apiRoot: z.string().optional(),
  debug: z.boolean().default(false),
  accounts: z.record(z.string(), TelegramAccountConfigSchema).optional(),
  dmPolicy: z.enum(['pairing', 'allowlist', 'open', 'disabled']).default('pairing'),
  groupPolicy: z.enum(['open', 'disabled', 'allowlist']).default('open'),
  replyToMode: z.enum(['off', 'first', 'all']).default('off'),
  streamMode: z.enum(['off', 'partial', 'block']).optional(),
  streaming: TelegramStreamingConfigSchema.optional(),
  historyLimit: z.number().default(50),
  textChunkLimit: z.number().default(4000),
  proxy: z.string().optional(),
});

export const TelegramConfigSchema = z.preprocess(preprocessTelegramConfigInput, TelegramConfigSchemaInner);

export type TelegramConfig = z.infer<typeof TelegramConfigSchema>;
export type TelegramStreamingConfig = z.infer<typeof TelegramStreamingConfigSchema>;

/** Resolve effective streaming mode for an account (streaming.mode wins over legacy streamMode). */
export function resolveTelegramStreamingMode(account: {
  streamMode?: 'off' | 'partial' | 'block';
  streaming?: { mode?: 'off' | 'partial' | 'block' | 'progress' };
}): 'off' | 'partial' | 'block' | 'progress' {
  const fromStreaming = account.streaming?.mode;
  if (fromStreaming) {
    return fromStreaming === 'progress' ? 'partial' : fromStreaming;
  }
  const legacy = account.streamMode ?? 'partial';
  return legacy;
}
