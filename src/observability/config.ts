import { z } from 'zod';

export const TracingConfigSchema = z.object({
  enabled: z.boolean().default(true),
  capture: z.enum(['metadata', 'redacted', 'detailed']).default('redacted'),
  detailedUntil: z.number().int().nonnegative().optional(),
  local: z.object({
    retentionDays: z.number().int().min(1).max(90).default(7),
    maxStoreMiB: z.number().int().min(16).max(4096).default(256),
    maxTraces: z.number().int().min(10).max(100000).default(10000),
    maxSpans: z.number().int().min(100).max(1000000).default(100000),
    maxTraceKiB: z.number().int().min(16).max(4096).default(1024),
    maxWriteMiBPerMinute: z.number().int().min(1).max(100).default(2),
  }).prefault({}),
  langfuse: z.object({
    enabled: z.boolean().default(false),
    baseUrl: z.string().url().max(2048).refine(value => ['http:', 'https:'].includes(new URL(value).protocol), 'HTTP(S) URL required').default('https://cloud.langfuse.com'),
  }).prefault({}),
}).strict();
export type TracingConfig = z.infer<typeof TracingConfigSchema>;
export const defaultTracingConfig = () => TracingConfigSchema.parse({});
