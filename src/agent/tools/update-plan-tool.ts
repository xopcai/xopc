import { Type } from '@sinclair/typebox';
import type { AgentTool, AgentToolResult } from '@earendil-works/pi-agent-core';

export type TurnPlanStatus = 'pending' | 'in_progress' | 'completed';

export interface TurnPlanStep {
  step: string;
  status: TurnPlanStatus;
}

export interface TurnPlanDetails {
  explanation?: string;
  plan: TurnPlanStep[];
}

const VALID_STATUSES = new Set<TurnPlanStatus>(['pending', 'in_progress', 'completed']);

const PlanStepSchema = Type.Object({
  step: Type.String({ minLength: 1, description: 'Short task step' }),
  status: Type.Union([
    Type.Literal('pending'),
    Type.Literal('in_progress'),
    Type.Literal('completed'),
  ]),
});

const UpdatePlanSchema = Type.Object({
  explanation: Type.Optional(Type.String({ description: 'Short reason for this plan update' })),
  plan: Type.Array(PlanStepSchema, {
    minItems: 1,
    maxItems: 8,
    description: 'Full current plan. Exactly zero or one step may be in_progress.',
  }),
});

function normalizePlan(raw: unknown): TurnPlanStep[] {
  if (!Array.isArray(raw)) {
    throw new Error('plan must be an array');
  }
  const plan = raw.map((item) => {
    const rec = item && typeof item === 'object' ? item as Record<string, unknown> : {};
    const step = String(rec.step ?? '').trim();
    const statusRaw = String(rec.status ?? '').trim();
    if (!step) {
      throw new Error('each plan item must include a non-empty step');
    }
    if (!VALID_STATUSES.has(statusRaw as TurnPlanStatus)) {
      throw new Error(`invalid plan status: ${statusRaw || '(empty)'}`);
    }
    return { step, status: statusRaw as TurnPlanStatus };
  });

  const active = plan.filter((item) => item.status === 'in_progress');
  if (active.length > 1) {
    throw new Error('at most one plan item may be in_progress');
  }
  return plan;
}

function formatPlan(details: TurnPlanDetails): string {
  const lines = details.plan.map((item) => `- [${item.status}] ${item.step}`);
  return [details.explanation?.trim(), ...lines].filter(Boolean).join('\n');
}

export function createUpdatePlanTool(): AgentTool {
  return {
    name: 'update_plan',
    label: 'Update Plan',
    description:
      'Update the current coding-task plan. Use for multi-step implementation, review, or debugging work. ' +
      'Keep the full plan current, with at most one step marked in_progress.',
    parameters: UpdatePlanSchema,
    async execute(_toolCallId, params): Promise<AgentToolResult<TurnPlanDetails>> {
      const rec = params as Record<string, unknown>;
      const details: TurnPlanDetails = {
        explanation: typeof rec.explanation === 'string' && rec.explanation.trim()
          ? rec.explanation.trim()
          : undefined,
        plan: normalizePlan(rec.plan),
      };
      return {
        content: [{ type: 'text', text: formatPlan(details) }],
        details,
      };
    },
  };
}
