import { z } from 'zod';

const identifier = z.string().trim().min(1).max(256);
const origin = z.url().superRefine((value, ctx) => {
  const url = new URL(value);
  if (!['http:', 'https:'].includes(url.protocol) || url.origin !== value) {
    ctx.addIssue({ code: 'custom', message: 'Expected a canonical HTTP(S) origin' });
  }
});

export const browserTabBindingModeSchema = z.enum(['read', 'act']);
export const browserTabBindingRequestSchema = z.strictObject({
  endpointId: identifier,
  turnToken: identifier,
  tabId: z.string().regex(/^\d+$/),
  windowId: z.string().regex(/^\d+$/),
  documentId: identifier,
  urlOrigin: origin,
  mode: browserTabBindingModeSchema,
});

export const browserTabBindingSchema = browserTabBindingRequestSchema.omit({ turnToken: true }).extend({
  id: z.uuid(),
  sessionKey: z.string().min(1).max(500),
  principalId: identifier,
  createdAt: z.number().int().nonnegative(),
  expiresAt: z.number().int().nonnegative(),
});

export type BrowserTabBindingMode = z.infer<typeof browserTabBindingModeSchema>;
export type BrowserTabBindingRequest = z.infer<typeof browserTabBindingRequestSchema>;
export type BrowserTabBinding = z.infer<typeof browserTabBindingSchema>;
