import { z } from 'zod';

import {
  TaskAttentionItemSchema,
  TaskDependencySummarySchema,
  TaskOperationalStateSchema,
  TaskPhaseSchema,
  TaskPrioritySchema,
  TaskResolutionSchema,
  TaskRunReceiptSchema,
} from './tasks.js';
import { ProjectMonitoringPolicySchema } from './project-monitoring.js';

export const ProjectSummarySchema = z.object({
  id: z.string(),
  name: z.string(),
  status: z.string(),
  description: z.string().optional(),
  brief: z.string().optional(),
  updatedAt: z.number(),
});

export const ProjectTaskDependencyEdgeSchema = z.object({
  dependencyTaskId: z.string(),
  dependentTaskId: z.string(),
});

export const ProjectTaskCardSchema = z.object({
  id: z.string(),
  title: z.string(),
  phase: TaskPhaseSchema,
  resolution: TaskResolutionSchema.optional(),
  operationalState: TaskOperationalStateSchema,
  priority: TaskPrioritySchema,
  dueAt: z.number().optional(),
  acceptanceCriteriaCount: z.number().int().nonnegative(),
  latestVerification: z.enum(['passed', 'failed', 'unverified']).optional(),
  nextCheckAt: z.number().int().nonnegative().optional(),
  attention: z.array(TaskAttentionItemSchema).default([]),
  blockedBy: z.array(TaskDependencySummarySchema).default([]),
  allowedCommands: z.array(z.string()),
  updatedAt: z.number(),
});

export const ProjectOperatingSummarySchema = z.object({
  health: z.enum(['healthy', 'attention', 'idle', 'empty']),
  summary: z.string(),
  recommendedAction: z.string().optional(),
  counts: z.object({
    ready: z.number().int().nonnegative(),
    moving: z.number().int().nonnegative(),
    waiting: z.number().int().nonnegative(),
    needsUser: z.number().int().nonnegative(),
    done: z.number().int().nonnegative(),
  }),
  updatedAt: z.number().int().nonnegative(),
});

export const ProjectOperatingViewSchema = z.object({
  project: ProjectSummarySchema,
  tasks: z.array(ProjectTaskCardSchema),
  dependencyEdges: z.array(ProjectTaskDependencyEdgeSchema),
  blockers: z.array(z.object({
    id: z.string(),
    taskId: z.string(),
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
  recentResults: z.array(z.object({
    taskId: z.string(),
    taskTitle: z.string(),
    receipt: TaskRunReceiptSchema,
  })),
  digest: z.object({
    health: z.enum(['healthy', 'attention', 'idle', 'empty']),
    summary: z.string(),
    recommendedAction: z.string().optional(),
  }),
  monitoring: ProjectMonitoringPolicySchema,
});

export type ProjectOperatingView = z.infer<typeof ProjectOperatingViewSchema>;
export type ProjectOperatingSummary = z.infer<typeof ProjectOperatingSummarySchema>;
export type ProjectTaskCard = z.infer<typeof ProjectTaskCardSchema>;
export type ProjectTaskDependencyEdge = z.infer<typeof ProjectTaskDependencyEdgeSchema>;
