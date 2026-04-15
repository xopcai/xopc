import { z } from 'zod';

export const WeixinAccountConfigSchema = z.object({
  name: z.string().optional(),
  enabled: z.boolean().optional(),
  cdnBaseUrl: z.string().optional(),
  routeTag: z.union([z.string(), z.number()]).optional(),
  dmPolicy: z.enum(['pairing', 'allowlist', 'open', 'disabled']).default('pairing'),
  allowFrom: z.array(z.string()).default([]),
  streamMode: z.enum(['off', 'partial', 'block']).optional(),
  debug: z.boolean().optional(),
});

export const WeixinConfigSchema = z.object({
  enabled: z.boolean().default(false),
  dmPolicy: z.enum(['pairing', 'allowlist', 'open', 'disabled']).default('pairing'),
  allowFrom: z.array(z.string()).default([]),
  debug: z.boolean().default(false),
  streamMode: z.enum(['off', 'partial', 'block']).optional(),
  historyLimit: z.number().default(50),
  textChunkLimit: z.number().default(4000),
  routeTag: z.union([z.string(), z.number()]).optional(),
  accounts: z.record(z.string(), WeixinAccountConfigSchema).optional(),
});

export type WeixinConfig = z.infer<typeof WeixinConfigSchema>;
