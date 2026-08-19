import { z } from 'zod';

import {
  TaskActionSchema,
  TaskPrioritySchema,
  TaskStatusSchema,
  TaskAttentionSchema,
  TaskProgressSchema,
  TaskReceiptSchema,
} from './tasks.js';
import { ProjectMonitoringPolicySchema } from './project-monitoring.js';

const ProjectSummarySchema = z.object({
  id: z.string(),
  name: z.string(),
  status: z.string(),
  description: z.string().optional(),
  brief: z.string().optional(),
  updatedAt: z.number(),
});

export const ProjectTaskLaneSchema = z.enum(['ready', 'moving', 'needs_user', 'done']);

export const ProjectTaskCardSchema = z.object({
  id: z.string(),
  title: z.string(),
  lane: ProjectTaskLaneSchema,
  status: TaskStatusSchema,
  priority: TaskPrioritySchema,
  dueAt: z.number().optional(),
  nextAction: z.string().optional(),
  blockedReason: z.string().optional(),
  activeSessionKey: z.string().optional(),
  acceptanceCriteriaCount: z.number().int().nonnegative(),
  latestVerification: z.enum(['passed', 'failed', 'unverified']).optional(),
  nextCheckAt: z.number().int().nonnegative().optional(),
  progress: TaskProgressSchema.optional(),
  attention: TaskAttentionSchema.optional(),
  blockedBy: z.array(z.object({
    id: z.string(),
    objective: z.string(),
    status: TaskStatusSchema,
  })).default([]),
  allowedActions: z.array(TaskActionSchema),
  updatedAt: z.number(),
});

export const ProjectOperatingViewSchema = z.object({
  project: ProjectSummarySchema,
  tasks: z.array(ProjectTaskCardSchema),
  blockers: z.array(z.object({
    id: z.string(),
    kind: z.string(),
    title: z.string(),
    detail: z.string().optional(),
    href: z.string().optional(),
    updatedAt: z.number().optional(),
  })),
  running: z.array(z.object({
    runId: z.string(),
    definitionId: z.string(),
    status: z.string(),
    createdAt: z.number(),
  })),
  recentReceipts: z.array(TaskReceiptSchema),
  digest: z.object({
    health: z.enum(['healthy', 'attention', 'idle', 'empty']),
    summary: z.string(),
    recommendedAction: z.string().optional(),
  }),
  monitoring: ProjectMonitoringPolicySchema,
});

export type ProjectOperatingView = z.infer<typeof ProjectOperatingViewSchema>;
export type ProjectTaskLane = z.infer<typeof ProjectTaskLaneSchema>;
export type ProjectTaskCard = z.infer<typeof ProjectTaskCardSchema>;
