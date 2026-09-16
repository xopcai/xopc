import { z } from 'zod';

export const ComputerConfigSchema = z.object({
  enabled: z.boolean().default(false),
  maxActionsPerSession: z.number().int().min(1).max(80).default(80),
  maxModelRequests: z.number().int().min(1).max(120).default(120),
  maxSessionDurationMs: z.number().int().min(1000).max(900_000).default(900_000),
  idleGrantTtlMs: z.number().int().min(1000).max(300_000).default(300_000),
}).strict().prefault({});
export type ComputerConfig = z.infer<typeof ComputerConfigSchema>;
