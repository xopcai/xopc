// Cron input validation using Zod
import { z } from 'zod';
import nodeCron from 'node-cron';

// Custom cron validation
const cronExpression = z.string().refine(
  (val) => nodeCron.validate(val),
  (val) => ({ message: `Invalid cron expression: ${val}` })
);

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

export const JobDataSchema = z.object({
  id: z.string().min(1).max(32),
  name: z.string().max(100).optional(),
  schedule: cronExpression,
  message: z.string().min(1).max(10000),
  enabled: z.boolean(),
  timezone: z.string().refine(
    (val) => !val || validTimezones.includes(val),
    (val) => ({ message: `Invalid timezone: ${val}. Use IANA timezone names.` })
  ).optional(),
  maxRetries: z.number().int().min(0).max(10).default(3),
  timeout: z.number().int().min(1000).max(300000).default(60000),
  created_at: z.string().datetime(),
  updated_at: z.string().datetime(),
});

export const AddJobRequestSchema = z.object({
  schedule: cronExpression,
  message: z.string().min(1).max(10000),
  name: z.string().max(100).optional(),
  timezone: z.string().optional(),
  maxRetries: z.number().int().min(0).max(10).optional(),
  timeout: z.number().int().min(1000).max(300000).optional(),
});

export const UpdateJobRequestSchema = z.object({
  name: z.string().max(100).optional(),
  schedule: cronExpression.optional(),
  message: z.string().min(1).max(10000).optional(),
  timezone: z.string().optional(),
  maxRetries: z.number().int().min(0).max(10).optional(),
  timeout: z.number().int().min(1000).max(300000).optional(),
  enabled: z.boolean().optional(),
}).refine(
  (data) => Object.keys(data).length > 0,
  { message: 'At least one field must be provided for update' }
);

export type ValidatedJobData = z.infer<typeof JobDataSchema>;
export type ValidatedAddJobRequest = z.infer<typeof AddJobRequestSchema>;
export type ValidatedUpdateJobRequest = z.infer<typeof UpdateJobRequestSchema>;

// Re-export common validation helpers
export { cronExpression };
