import { z } from 'zod';

import { shouldRejectLoopbackGatewayBaseUrl } from '../stores/gateway-types';

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
    .refine(isValidHttpUrl, 'Must be a valid http(s) URL')
    .refine((url) => !shouldRejectLoopbackGatewayBaseUrl(url), 'LOOPBACK_NOT_REACHABLE'),
  token: z.string(),
});

export type GatewaySettingsForm = z.infer<typeof gatewaySettingsSchema>;

export const gatewayProfileSchema = gatewaySettingsSchema.extend({
  name: z.string().trim(),
});

export type GatewayProfileForm = z.infer<typeof gatewayProfileSchema>;

export const sessionListItemSchema = z
  .object({
    key: z.string(),
    name: z.string().optional(),
    title: z.string().optional(),
    displayName: z.string().optional(),
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

export const notesListResponseSchema = z.object({
  items: z.array(z.unknown()),
  total: z.number(),
  limit: z.number().optional(),
  offset: z.number().optional(),
  hasMore: z.boolean().optional(),
});

export const agentsResponseSchema = z.object({
  ok: z.literal(true),
  payload: z.object({
    defaultId: z.string(),
    builtinToolIds: z.array(z.string()).optional(),
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
