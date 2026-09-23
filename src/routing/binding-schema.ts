import { z } from 'zod';

export const BindingMatchSchema = z.object({
  channel: z.string(),
  accountId: z.string().optional(),
  peerKind: z.string().optional(),
  peerId: z.string().optional(),
  guildId: z.string().optional(),
  teamId: z.string().optional(),
  memberRoleIds: z.array(z.string()).optional(),
}).strict();

export const BindingRuleSchema = z.object({
  id: z.string().optional(),
  agentId: z.string(),
  priority: z.number().default(100),
  match: BindingMatchSchema,
  enabled: z.boolean().default(true),
}).strict();

export const BindingsSchema = z.array(BindingRuleSchema).default([]);

export type BindingRule = z.infer<typeof BindingRuleSchema>;

