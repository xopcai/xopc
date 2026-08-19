import { z } from 'zod';

import { OutcomeReceiptSchema } from './outcomes.js';
import { ProjectMonitoringPolicySchema } from './project-monitoring.js';

const ProjectSummarySchema = z.object({
  id: z.string(),
  name: z.string(),
  status: z.string(),
  description: z.string().optional(),
  brief: z.string().optional(),
  updatedAt: z.number(),
});

const OutcomeSummarySchema = z.object({
  id: z.string(),
  title: z.string(),
  status: z.string(),
  nextAction: z.string().optional(),
  blockedReason: z.string().optional(),
  updatedAt: z.number(),
});

const ActionSummarySchema = z.object({
  id: z.string(),
  title: z.string(),
  phase: z.enum(['backlog', 'ready', 'executing', 'verifying', 'closed']),
  priority: z.string(),
  nextAction: z.object({
    text: z.string(),
    actor: z.enum(['agent', 'user', 'external', 'system']),
    dueAt: z.number().optional(),
  }).optional(),
  waits: z.array(z.object({ kind: z.string(), reason: z.string() })),
  updatedAt: z.number(),
});

export const ProjectOperatingViewSchema = z.object({
  project: ProjectSummarySchema,
  desiredOutcomes: z.array(OutcomeSummarySchema),
  currentActions: z.array(ActionSummarySchema),
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
  recentReceipts: z.array(OutcomeReceiptSchema),
  digest: z.object({
    health: z.enum(['healthy', 'attention', 'idle', 'empty']),
    summary: z.string(),
    recommendedAction: z.string().optional(),
  }),
  monitoring: ProjectMonitoringPolicySchema,
});

export type ProjectOperatingView = z.infer<typeof ProjectOperatingViewSchema>;
