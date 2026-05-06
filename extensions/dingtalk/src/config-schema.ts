import { z } from 'zod';

export const DEFAULT_DINGTALK_ACCOUNT_ID = 'default';

const DmPolicySchema = z.enum(['pairing', 'allowlist', 'open', 'disabled']);
const GroupPolicySchema = z.enum(['open', 'disabled', 'allowlist']);

export const DingtalkAccountOverrideSchema = z
  .object({
    enabled: z.boolean().optional(),
    clientId: z.string().optional(),
    clientSecret: z.string().optional(),
    dmPolicy: DmPolicySchema.optional(),
    groupPolicy: GroupPolicySchema.optional(),
    allowFrom: z.array(z.union([z.string(), z.number()])).optional(),
    groupAllowFrom: z.array(z.union([z.string(), z.number()])).optional(),
    requireMention: z.boolean().optional(),
    debug: z.boolean().optional(),
    endpoint: z.string().optional(),
    historyLimit: z.number().int().min(0).optional(),
    textChunkLimit: z.number().int().positive().optional(),
  })
  .strict();

export const DingtalkConfigSchema = z
  .object({
    enabled: z.boolean().optional(),
    clientId: z.string().optional(),
    clientSecret: z.string().optional(),
    dmPolicy: DmPolicySchema.optional(),
    groupPolicy: GroupPolicySchema.optional(),
    allowFrom: z.array(z.union([z.string(), z.number()])).optional(),
    groupAllowFrom: z.array(z.union([z.string(), z.number()])).optional(),
    requireMention: z.boolean().optional(),
    debug: z.boolean().optional(),
    endpoint: z.string().optional(),
    historyLimit: z.number().int().min(0).optional(),
    textChunkLimit: z.number().int().positive().optional(),
    accounts: z.record(z.string(), DingtalkAccountOverrideSchema.optional()).optional(),
    defaultAccount: z.string().optional(),
  })
  .strict();

export type DingtalkConfig = z.infer<typeof DingtalkConfigSchema>;
export type DingtalkAccountOverride = z.infer<typeof DingtalkAccountOverrideSchema>;
