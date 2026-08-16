import { Type } from '@sinclair/typebox';
import type { AgentTool } from '@earendil-works/pi-agent-core';
import {
  appendProductDeliveryText,
  type ProductDeliveryEnvelope,
} from '@xopcai/gateway-contract';

import { GoalService, type Goal, type GoalPriority, type GoalStatus } from '../../goals/index.js';
import { getSessionMetadata } from '../../storage/sqlite/index.js';
import { OutcomeExecutionService } from '../../work/index.js';

const GoalToolSchema = Type.Object({
  action: Type.Union([
    Type.Literal('list'),
    Type.Literal('create'),
    Type.Literal('update'),
  ]),
  goalId: Type.Optional(Type.String({ description: 'Goal id for update.' })),
  title: Type.Optional(Type.String({ description: 'Goal title for create/update.' })),
  description: Type.Optional(Type.String({ description: 'Goal description.' })),
  status: Type.Optional(Type.Union([
    Type.Literal('active'),
    Type.Literal('paused'),
    Type.Literal('blocked'),
    Type.Literal('needs_input'),
    Type.Literal('done'),
    Type.Literal('archived'),
  ])),
  priority: Type.Optional(Type.Union([
    Type.Literal('low'),
    Type.Literal('normal'),
    Type.Literal('high'),
  ])),
  maxTurns: Type.Optional(Type.Number({ minimum: 1, maximum: 500 })),
  deadlineAt: Type.Optional(Type.Number({ description: 'Unix timestamp in milliseconds.' })),
  nextAction: Type.Optional(Type.String()),
  blockedReason: Type.Optional(Type.String()),
  judgeModelRef: Type.Optional(Type.String()),
  agentId: Type.Optional(Type.String()),
  sessionKey: Type.Optional(Type.String()),
  projectId: Type.Optional(Type.String()),
  limit: Type.Optional(Type.Number({ minimum: 1, maximum: 100 })),
});

type GoalToolParams = {
  action: 'list' | 'create' | 'update';
  goalId?: string;
  title?: string;
  description?: string;
  status?: GoalStatus;
  priority?: GoalPriority;
  maxTurns?: number;
  deadlineAt?: number;
  nextAction?: string;
  blockedReason?: string;
  judgeModelRef?: string;
  agentId?: string;
  sessionKey?: string;
  projectId?: string;
  limit?: number;
};

export interface GoalToolOptions {
  getCurrentSessionKey?: () => string | undefined;
}

type GoalToolDetails = {
  goal?: Goal;
  delivery?: ProductDeliveryEnvelope;
};

function goalDelivery(goal: Goal, operation: 'created' | 'updated'): ProductDeliveryEnvelope {
  return {
    version: 1,
    operation,
    primary: {
      kind: 'goal',
      id: goal.id,
      title: goal.title,
      summary: goal.description?.trim() || goal.nextAction?.trim() || undefined,
      status: goal.status,
      revision: String(goal.updatedAt),
      projectId: goal.projectId ?? undefined,
      capabilities: ['open', 'edit', 'continue_in_chat', 'pause', 'resume'],
    },
  };
}

function textResult(text: string, details: GoalToolDetails = {}) {
  return {
    content: [{ type: 'text' as const, text: appendProductDeliveryText(text, details.delivery) }],
    details,
  };
}

export function createGoalTool(options: GoalToolOptions = {}): AgentTool<typeof GoalToolSchema, GoalToolDetails> {
  return {
    name: 'goal',
    label: 'Goal',
    description:
      'Create, list, or update durable goals. Use this from workflows when work should become a tracked long-running goal.',
    parameters: GoalToolSchema,
    async execute(_toolCallId, params: GoalToolParams) {
      const goals = new GoalService();
      if (params.action === 'list') {
        const rows = goals.list({ limit: Math.max(1, Math.min(100, Math.floor(params.limit ?? 20))) });
        if (!rows.length) return textResult('No goals.');
        return textResult(rows.map((g) => `${g.id} [${g.status}] ${g.title}`).join('\n'));
      }

      if (params.action === 'create') {
        const title = params.title?.trim();
        if (!title) return textResult('Error: title is required.');
        const sessionKey = params.sessionKey?.trim() || options.getCurrentSessionKey?.()?.trim();
        const projectId = params.projectId?.trim() || (sessionKey ? getSessionMetadata(sessionKey)?.projectId : undefined);
        const goal = new OutcomeExecutionService().create({
          objective: title,
          description: params.description,
          agentId: params.agentId,
          sessionKey,
          projectId,
          priority: params.priority,
          deadlineAt: params.deadlineAt,
          judgeModelRef: params.judgeModelRef,
          maxTurns: params.maxTurns,
          source: 'workflow',
        }).goal;
        return textResult(`Created goal ${goal.id}\n${goal.title}`, {
          goal,
          delivery: goalDelivery(goal, 'created'),
        });
      }

      const goalId = params.goalId?.trim();
      if (!goalId) return textResult('Error: goalId is required.');
      let goal = goals.update(goalId, {
        ...(params.title !== undefined ? { title: params.title } : {}),
        ...(params.description !== undefined ? { description: params.description } : {}),
        ...(params.priority !== undefined ? { priority: params.priority } : {}),
        ...(params.deadlineAt !== undefined ? { deadlineAt: params.deadlineAt } : {}),
        ...(params.maxTurns !== undefined ? { maxTurns: params.maxTurns } : {}),
        ...(params.nextAction !== undefined ? { nextAction: params.nextAction } : {}),
        ...(params.blockedReason !== undefined ? { blockedReason: params.blockedReason } : {}),
        ...(params.judgeModelRef !== undefined ? { judgeModelRef: params.judgeModelRef } : {}),
      });
      if (!goal) return textResult(`Goal not found: ${goalId}`);
      if (params.status) {
        goal = goals.setStatus(goalId, params.status, { reason: params.blockedReason });
      }
      return textResult(`Updated goal ${goalId}\n${goal?.title ?? ''}`, goal
        ? { goal, delivery: goalDelivery(goal, 'updated') }
        : {});
    },
  };
}
