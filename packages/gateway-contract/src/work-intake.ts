import { z } from 'zod';

export const WorkExecutionModeSchema = z.enum(['create_only', 'run_now']);
export const WorkExecutionStatusSchema = z.enum([
  'not_started',
  'queued',
  'running',
  'retry_waiting',
  'succeeded',
  'failed',
  'skipped',
]);
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
  projectId: z.string().optional(),
  planningContext: z.object({
    supportMode: z.enum(['efficient', 'coach', 'companion', 'auto']),
    proactiveEnabled: z.boolean(),
  }),
  outcomeContract: z.object({
    objective: z.string(),
    deliverables: z.array(z.string()),
    acceptanceCriteria: z.array(z.string()),
    constraints: z.array(z.string()),
    approvalRequired: z.array(z.string()),
    assumptions: z.array(z.string()),
    risks: z.array(z.string()),
  }),
  executionReadiness: z.object({
    confidence: z.number().min(0).max(1),
    canStartImmediately: z.boolean(),
    blockingDecision: z.object({
      id: z.string(),
      question: z.string(),
      recommendation: z.string(),
    }).optional(),
  }),
  expiresAt: z.number(),
});

export const WorkIntakeCreateRequestSchema = z.object({
  idempotencyKey: z.string().min(1).max(200),
  objective: z.string().min(1).max(12_000),
  projectId: z.string().min(1).optional(),
  sessionKey: z.string().min(1).optional(),
  agentId: z.string().min(1).optional(),
});

export const WorkIntakeConfirmRequestSchema = z.object({
  executionMode: WorkExecutionModeSchema,
  projectId: z.string().min(1).optional(),
  blockingDecisionId: z.string().min(1).optional(),
});

export const ConfirmedWorkSchema = z.object({
  outcomeId: z.string(),
  projectId: z.string().optional(),
  sessionKey: z.string().optional(),
  execution: z.object({
    mode: WorkExecutionModeSchema,
    status: WorkExecutionStatusSchema,
    queueId: z.string().optional(),
  }),
});

export type WorkExecutionMode = z.infer<typeof WorkExecutionModeSchema>;
export type WorkExecutionStatus = z.infer<typeof WorkExecutionStatusSchema>;
export type MonitoringMode = z.infer<typeof MonitoringModeSchema>;
export type QuietHours = z.infer<typeof QuietHoursSchema>;
export type ProjectMonitoringPolicy = z.infer<typeof ProjectMonitoringPolicySchema>;
export type ProjectMonitoringUpdate = z.infer<typeof ProjectMonitoringUpdateSchema>;
export type WorkIntakeProposal = z.infer<typeof WorkIntakeProposalSchema>;
export type WorkIntakeCreateRequest = z.infer<typeof WorkIntakeCreateRequestSchema>;
export type WorkIntakeConfirmRequest = z.infer<typeof WorkIntakeConfirmRequestSchema>;
export type ConfirmedWork = z.infer<typeof ConfirmedWorkSchema>;
