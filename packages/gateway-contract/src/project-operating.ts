import { z } from 'zod';

import { OutcomeReceiptSchema } from './outcomes.js';
import { ProjectMonitoringPolicySchema } from './work-intake.js';

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
  status: z.string(),
  priority: z.string(),
  nextAction: z.string().optional(),
  blockedReason: z.string().optional(),
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
