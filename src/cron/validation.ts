// Cron input validation using Zod
import { z } from 'zod';
import nodeCron from 'node-cron';

// Custom cron validation
const cronExpression = z.string().superRefine((val, ctx) => {
  if (!nodeCron.validate(val)) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      message: `Invalid cron expression: ${val}`,
    });
  }
});

// Valid timezones (subset of IANA timezones)
const validTimezones = [
  'UTC',
  'America/New_York',
  'America/Chicago',
  'America/Denver',
  'America/Los_Angeles',
  'America/Toronto',
  'Europe/London',
  'Europe/Paris',
  'Europe/Berlin',
  'Europe/Moscow',
  'Asia/Tokyo',
  'Asia/Shanghai',
  'Asia/Hong_Kong',
  'Asia/Singapore',
  'Asia/Seoul',
  'Asia/Dubai',
  'Asia/Mumbai',
  'Australia/Sydney',
  'Pacific/Auckland',
];

// Valid delivery channels
const validChannels = ['telegram', 'whatsapp', 'cli'] as const;
const CronDeliveryMode = z.enum(['none', 'announce', 'direct']);

// CronPayload validation
const CronSystemEventPayloadSchema = z.object({
  kind: z.literal('systemEvent'),
  text: z.string().min(1).max(50000),
});

const CronAgentTurnPayloadSchema = z.object({
  kind: z.literal('agentTurn'),
  message: z.string().min(1).max(50000),
  model: z.string().max(100).optional(),
  timeoutSeconds: z.number().int().min(10).max(3600).optional(),
});

const CronPayloadSchema = z.union([
  CronSystemEventPayloadSchema,
  CronAgentTurnPayloadSchema,
]);

// CronDelivery validation
const CronDeliverySchema = z.object({
  mode: CronDeliveryMode.default('none'),
  channel: z.enum(validChannels).optional(),
  to: z.string().max(100).optional(),
  bestEffort: z.boolean().optional(),
});

export const JobDataSchema = z.object({
  id: z.string().min(1).max(32),
  name: z.string().max(100).optional(),
  schedule: cronExpression,
  message: z.string().min(1).max(10000),
  enabled: z.boolean(),
  timezone: z.string().superRefine((val, ctx) => {
    if (val && !validTimezones.includes(val)) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: `Invalid timezone: ${val}. Use IANA timezone names.`,
      });
    }
  }).optional(),
  maxRetries: z.number().int().min(0).max(10).default(3),
  timeout: z.number().int().min(1000).max(300000).default(60000),
  created_at: z.string().datetime(),
  updated_at: z.string().datetime(),
  // New fields
  sessionTarget: z.enum(['main', 'isolated']).optional(),
  payload: CronPayloadSchema.optional(),
  delivery: CronDeliverySchema.optional(),
  model: z.string().max(100).optional(),
});

export const AddJobRequestSchema = z.object({
  schedule: cronExpression,
  message: z.string().min(1).max(10000),
  name: z.string().max(100).optional(),
  timezone: z.string().optional(),
  maxRetries: z.number().int().min(0).max(10).optional(),
  timeout: z.number().int().min(1000).max(300000).optional(),
  // New fields
  sessionTarget: z.enum(['main', 'isolated']).optional(),
  payload: CronPayloadSchema.optional(),
  delivery: CronDeliverySchema.optional(),
  model: z.string().max(100).optional(),
});

export const UpdateJobRequestSchema = z.object({
  name: z.string().max(100).optional(),
  schedule: cronExpression.optional(),
  message: z.string().min(1).max(10000).optional(),
  timezone: z.string().optional(),
  maxRetries: z.number().int().min(0).max(10).optional(),
  timeout: z.number().int().min(1000).max(300000).optional(),
  enabled: z.boolean().optional(),
  // New fields
  sessionTarget: z.enum(['main', 'isolated']).optional(),
  payload: CronPayloadSchema.optional(),
  delivery: CronDeliverySchema.optional(),
  model: z.string().max(100).optional(),
}).refine(
  (data) => Object.keys(data).length > 0,
  { message: 'At least one field must be provided for update' }
);

export type ValidatedJobData = z.infer<typeof JobDataSchema>;
export type ValidatedAddJobRequest = z.infer<typeof AddJobRequestSchema>;
export type ValidatedUpdateJobRequest = z.infer<typeof UpdateJobRequestSchema>;
export type ValidatedCronPayload = z.infer<typeof CronPayloadSchema>;
export type ValidatedCronDelivery = z.infer<typeof CronDeliverySchema>;

// Re-export common validation helpers
export { cronExpression };
