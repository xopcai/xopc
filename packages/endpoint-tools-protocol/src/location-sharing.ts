import { z } from 'zod';
import { locationSampleSchema } from './location.js';

export const locationShareRequestSchema = z.strictObject({
  conversationId: z.uuid(), phoneId: z.uuid().optional(),
  precision: z.enum(['approximate', 'precise']), mode: z.enum(['once', 'while_in_use']),
  durationMs: z.number().int().min(30_000).max(900_000).default(300_000),
});
export type LocationShareRequest = z.infer<typeof locationShareRequestSchema>;
export const locationShareSampleSchema = z.strictObject({ sequence: z.number().int().positive(), sample: locationSampleSchema });
export interface LocationShareSummary {
  id: string; endpointId: string; conversationId: string; phoneId?: string;
  precision: 'approximate' | 'precise'; mode: 'once' | 'while_in_use'; expiresAt: number;
  status: 'waiting' | 'fresh' | 'stale' | 'revoked' | 'expired' | 'source_unavailable';
  sync: 'not_requested' | 'pending' | 'applied' | 'cleanup_pending' | 'clean' | 'failed';
  capturedAt?: number; validUntil?: number; accuracyMeters?: number; valueRef?: string;
}
export const locationShareSummarySchema = z.object({
  id: z.uuid(), endpointId: z.string().min(1).max(160), conversationId: z.uuid(), phoneId: z.uuid().optional(),
  precision: z.enum(['approximate', 'precise']), mode: z.enum(['once', 'while_in_use']), expiresAt: z.number().int().nonnegative(),
  status: z.enum(['waiting', 'fresh', 'stale', 'revoked', 'expired', 'source_unavailable']),
  sync: z.enum(['not_requested', 'pending', 'applied', 'cleanup_pending', 'clean', 'failed']),
  capturedAt: z.number().int().nonnegative().optional(), validUntil: z.number().int().nonnegative().optional(),
  accuracyMeters: z.number().nonnegative().optional(), valueRef: z.uuid().optional(),
});
