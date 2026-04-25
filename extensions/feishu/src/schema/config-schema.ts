import { z } from 'zod';

export const FeishuAccountConfigSchema = z.object({
  name: z.string().optional(),
  enabled: z.boolean().optional(),

  /** Feishu app credentials */
  appId: z.string().optional(),
  appSecret: z.string().optional(),

  /** feishu | lark | https://open.feishu.cn (custom base) */
  domain: z.union([z.enum(['feishu', 'lark']), z.string().url()]).optional(),

  /** Socket Mode is the default transport in xopc. */
  connectionMode: z.enum(['websocket', 'webhook']).default('websocket').optional(),

  /** Access control */
  dmPolicy: z.enum(['pairing', 'allowlist', 'open', 'disabled']).default('pairing').optional(),
  groupPolicy: z.enum(['open', 'disabled', 'allowlist']).default('allowlist').optional(),
  allowFrom: z.array(z.union([z.string(), z.number()])).optional(),
  groupAllowFrom: z.array(z.union([z.string(), z.number()])).optional(),
  requireMention: z.boolean().optional(),

  /** Messaging */
  historyLimit: z.number().int().min(0).optional(),
  textChunkLimit: z.number().int().positive().optional(),
  renderMode: z.enum(['auto', 'raw', 'card']).optional(),
  replyInThread: z.enum(['disabled', 'enabled']).optional(),
  typingIndicator: z.boolean().optional(),
  reactionNotifications: z.enum(['off', 'own', 'all']).optional(),

  /** Streaming */
  streaming: z.boolean().optional(),
  blockStreamingCoalesce: z
    .object({
      enabled: z.boolean().optional(),
      minChars: z.number().int().positive().optional(),
      idleMs: z.number().int().positive().optional(),
    })
    .strict()
    .optional(),

  /** Tool gates (parity surface; implementations come later) */
  tools: z
    .object({
      doc: z.boolean().optional(),
      chat: z.boolean().optional(),
      wiki: z.boolean().optional(),
      drive: z.boolean().optional(),
      perm: z.boolean().optional(),
      bitable: z.boolean().optional(),
      scopes: z.boolean().optional(),
    })
    .strict()
    .optional(),

  actions: z
    .object({
      reactions: z.boolean().optional(),
    })
    .strict()
    .optional(),

  /** Dynamic agent creation for DMs (parity surface; core wiring comes later) */
  dynamicAgentCreation: z
    .object({
      enabled: z.boolean().optional(),
      workspaceTemplate: z.string().optional(),
      agentDirTemplate: z.string().optional(),
      maxAgents: z.number().int().positive().optional(),
    })
    .strict()
    .optional(),
});

export const FeishuConfigSchema = z
  .object({
  enabled: z.boolean().default(false),

  defaultAccount: z.string().optional(),

  /** Single-account shorthand (backward compatible in our own schema) */
  appId: z.string().optional(),
  appSecret: z.string().optional(),
  domain: z.union([z.enum(['feishu', 'lark']), z.string().url()]).default('feishu').optional(),
  connectionMode: z.enum(['websocket', 'webhook']).default('websocket').optional(),

  dmPolicy: z.enum(['pairing', 'allowlist', 'open', 'disabled']).default('pairing').optional(),
  groupPolicy: z.enum(['open', 'disabled', 'allowlist']).default('allowlist').optional(),
  allowFrom: z.array(z.union([z.string(), z.number()])).default([]).optional(),
  groupAllowFrom: z.array(z.union([z.string(), z.number()])).default([]).optional(),
  requireMention: z.boolean().optional(),

  historyLimit: z.number().int().min(0).default(50).optional(),
  textChunkLimit: z.number().int().positive().default(4000).optional(),
  reactionNotifications: z.enum(['off', 'own', 'all']).optional(),

  streaming: z.boolean().optional(),
  blockStreamingCoalesce: z
    .object({
      enabled: z.boolean().optional(),
      minChars: z.number().int().positive().optional(),
      idleMs: z.number().int().positive().optional(),
    })
    .strict()
    .optional(),

  tools: z
    .object({
      doc: z.boolean().optional(),
      chat: z.boolean().optional(),
      wiki: z.boolean().optional(),
      drive: z.boolean().optional(),
      perm: z.boolean().optional(),
      bitable: z.boolean().optional(),
      scopes: z.boolean().optional(),
    })
    .strict()
    .optional(),

  actions: z
    .object({
      reactions: z.boolean().optional(),
    })
    .strict()
    .optional(),

  dynamicAgentCreation: z
    .object({
      enabled: z.boolean().optional(),
      workspaceTemplate: z.string().optional(),
      agentDirTemplate: z.string().optional(),
      maxAgents: z.number().int().positive().optional(),
    })
    .strict()
    .optional(),

  accounts: z.record(z.string(), FeishuAccountConfigSchema).optional(),
})
  .superRefine((value, ctx) => {
    // Single-account layout required fields when enabled.
    if (value.enabled) {
      const hasNamed = value.accounts && Object.keys(value.accounts).length > 0;
      if (!hasNamed) {
        if (!value.appId?.trim()) {
          ctx.addIssue({
            code: z.ZodIssueCode.custom,
            path: ['appId'],
            message: 'channels.feishu.enabled=true requires channels.feishu.appId (or configure channels.feishu.accounts)',
          });
        }
        if (!value.appSecret?.trim()) {
          ctx.addIssue({
            code: z.ZodIssueCode.custom,
            path: ['appSecret'],
            message:
              'channels.feishu.enabled=true requires channels.feishu.appSecret (or configure channels.feishu.accounts)',
          });
        }
      }
    }

    // Multi-account required fields when account is enabled.
    for (const [id, acc] of Object.entries(value.accounts ?? {})) {
      if (!acc) continue;
      if (acc.enabled === false) continue;
      const effectiveAppId = acc.appId?.trim() || value.appId?.trim() || '';
      const effectiveAppSecret = acc.appSecret?.trim() || value.appSecret?.trim() || '';
      if (!effectiveAppId) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          path: ['accounts', id, 'appId'],
          message: `channels.feishu.accounts.${id} requires appId (or top-level channels.feishu.appId)`,
        });
      }
      if (!effectiveAppSecret) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          path: ['accounts', id, 'appSecret'],
          message: `channels.feishu.accounts.${id} requires appSecret (or top-level channels.feishu.appSecret)`,
        });
      }
    }
  });

export type FeishuConfig = z.infer<typeof FeishuConfigSchema>;
export type FeishuAccountConfig = z.infer<typeof FeishuAccountConfigSchema>;

