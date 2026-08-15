import { z } from 'zod';

export const WorkIntakeClassificationSchema = z.enum(['one_off', 'existing_project', 'new_project']);
export const MonitoringModeSchema = z.enum(['observe', 'ask_before_action', 'auto_low_risk']);
export const QuietHoursSchema = z.object({
  startHour: z.number().int().min(0).max(23),
  endHour: z.number().int().min(0).max(23),
  timezone: z.string().min(1),
});

export const ProjectMonitoringPolicySchema = z.object({
  projectId: z.string(),
  mode: MonitoringModeSchema,
  quietHours: QuietHoursSchema.optional(),
  allowedActions: z.array(z.string()),
  confidenceThreshold: z.number().min(0).max(1),
  scenarios: z.array(z.string()),
  configured: z.boolean(),
  updatedAt: z.number().optional(),
});

export const ProjectMonitoringUpdateSchema = z.object({
  mode: MonitoringModeSchema.optional(),
  quietHours: QuietHoursSchema.nullable().optional(),
  allowedActions: z.array(z.string()).optional(),
  confidenceThreshold: z.number().min(0).max(1).optional(),
  scenarios: z.array(z.string()).optional(),
});

export const WorkIntakeProposalSchema = z.object({
  id: z.string(),
  objective: z.string(),
  classification: WorkIntakeClassificationSchema,
  suggestedProject: z.object({
    id: z.string().optional(),
    name: z.string(),
    outcome: z.string(),
    nextAction: z.string(),
  }),
  possibleProjectMatches: z.array(z.object({
    id: z.string(),
    name: z.string(),
    score: z.number(),
  })),
  monitoringSuggestion: z.object({
    mode: MonitoringModeSchema,
    scenarios: z.array(z.string()),
  }),
  expiresAt: z.number(),
});

export const ConfirmedWorkSchema = z.object({
  projectId: z.string(),
  goalId: z.string(),
  workItemId: z.string(),
  sessionKey: z.string().optional(),
});

export type WorkIntakeClassification = z.infer<typeof WorkIntakeClassificationSchema>;
export type MonitoringMode = z.infer<typeof MonitoringModeSchema>;
export type QuietHours = z.infer<typeof QuietHoursSchema>;
export type ProjectMonitoringPolicy = z.infer<typeof ProjectMonitoringPolicySchema>;
export type ProjectMonitoringUpdate = z.infer<typeof ProjectMonitoringUpdateSchema>;
export type WorkIntakeProposal = z.infer<typeof WorkIntakeProposalSchema>;
export type ConfirmedWork = z.infer<typeof ConfirmedWorkSchema>;
