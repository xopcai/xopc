import { z } from 'zod';

function isValidHttpUrl(s: string): boolean {
  try {
    const u = new URL(s);
    return u.protocol === 'http:' || u.protocol === 'https:';
  } catch {
    return false;
  }
}

export const gatewaySettingsSchema = z.object({
  baseUrl: z
    .string()
    .trim()
    .min(1, 'Base URL is required')
    .refine(isValidHttpUrl, 'Must be a valid http(s) URL'),
  token: z.string(),
  thinking: z.string(),
});

export type GatewaySettingsForm = z.infer<typeof gatewaySettingsSchema>;

export const sessionListItemSchema = z
  .object({
    key: z.string(),
    name: z.string().optional(),
    messageCount: z.number(),
    updatedAt: z.string(),
    sourceChannel: z.string().optional(),
  })
  .passthrough();

export type SessionListItem = z.infer<typeof sessionListItemSchema>;

export const sessionsListResponseSchema = z.object({
  items: z.array(z.unknown()),
  total: z.number(),
  limit: z.number(),
  offset: z.number(),
  hasMore: z.boolean(),
});

export const agentsResponseSchema = z.object({
  ok: z.literal(true),
  payload: z.object({
    defaultId: z.string(),
    agents: z.array(
      z
        .object({
          id: z.string(),
          name: z.string().optional(),
          description: z.string().optional(),
        })
        .passthrough(),
    ),
  }),
});
