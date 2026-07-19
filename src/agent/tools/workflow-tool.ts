/**
 * `workflow` — starts a persisted workflow run in a dedicated chat session.
 */

import { Type } from '@sinclair/typebox';
import type { AgentTool, AgentToolResult } from '@earendil-works/pi-agent-core';

import { extractProfileAgentId } from '../../config/agent-profile.js';
import { createLogger } from '../../utils/logger.js';
import type { WorkflowCatalog } from '../workflow/catalog.js';
import type {
  StartWorkflowRunServiceParams,
  WorkflowRunServiceResult,
} from '../../workflows/service/workflow-run-service.types.js';

const log = createLogger('Agent:WorkflowTool');

const WorkflowToolSchema = Type.Object({
  name: Type.Optional(
    Type.String({
      description:
        'Name of a saved visual workflow to run.',
    }),
  ),
  args: Type.Optional(
    Type.Any({
      description: 'Optional JSON value passed as workflow input payload.',
    }),
  ),
  goal: Type.Optional(
    Type.String({
      description: 'Optional goal or task description for this workflow run (defaults to user intent in chat).',
    }),
  ),
  goalId: Type.Optional(
    Type.String({
      description: 'Optional durable Goal id. When set, terminal workflow output is archived to that Goal.',
    }),
  ),
});

export type WorkflowToolInput = {
  name?: string;
  args?: unknown;
  goal?: string;
  goalId?: string;
};

export interface WorkflowToolDeps {
  catalog: WorkflowCatalog;
  getCurrentSessionKey?: () => string | undefined;
  getConfig: () => import('../../config/schema.js').Config | undefined;
  startWorkflowRun?: (params: StartWorkflowRunServiceParams) => Promise<WorkflowRunServiceResult>;
}

export function createWorkflowTool(deps: WorkflowToolDeps): AgentTool {
  return {
    name: 'workflow',
    label: '◆ Workflow',
    description: [
      'Start a multi-agent workflow run in its own chat session.',
      'Use `name` for a workflow from the visual workflow catalog.',
      'Returns immediately with runId + sessionKey — track progress in the linked chat session.',
    ].join(' '),
    parameters: WorkflowToolSchema,

    async execute(
      _toolCallId: string,
      params: WorkflowToolInput,
    ): Promise<AgentToolResult<{ runId: string; sessionKey: string } | { error: string }>> {
      if (!deps.startWorkflowRun) {
        return {
          content: [{ type: 'text', text: 'workflow: gateway workflow runs are not available in this context' }],
          details: { error: 'workflow_run_unavailable' },
        };
      }

      let definitionId: string;
      try {
        definitionId = resolveDefinitionId(params, deps.catalog);
      } catch (e) {
        const message = e instanceof Error ? e.message : String(e);
        return {
          content: [{ type: 'text', text: `workflow: ${message}` }],
          details: { error: message },
        };
      }

      const config = deps.getConfig();
      const parentSessionKey = deps.getCurrentSessionKey?.()?.trim();
      const agentId = extractProfileAgentId(parentSessionKey, config);

      const goal = params.goal?.trim() || '';
      const goalId = params.goalId?.trim();
      const source = parentSessionKey
        ? ({ kind: 'chat' as const, sessionKey: parentSessionKey })
        : ({ kind: 'api' as const });
      const inputEnvelope = goalId
        ? {
            payload: params.args ?? {},
            ...(goal ? { goal } : {}),
          }
        : undefined;

      try {
        const result = await deps.startWorkflowRun({
          agentId,
          definitionId,
          goal,
          goalId,
          input: inputEnvelope ? undefined : params.args,
          inputEnvelope,
          parentSessionKey,
          source,
        });

        if (result.ok === false) {
          return {
            content: [{ type: 'text', text: `workflow: ${result.message}` }],
            details: { error: result.message },
          };
        }

        const summary = goal
          ? `Started workflow \`${definitionId}\` (run ${result.runId}). Open chat session to track progress and continue.`
          : `Started workflow \`${definitionId}\` (run ${result.runId}). Open the workflow chat session to track progress.`;

        return {
          content: [
            {
              type: 'text',
              text: `${summary}\n\nsessionKey: ${result.sessionKey}`,
            },
          ],
          details: {
            runId: result.runId,
            sessionKey: result.sessionKey,
            definitionId,
            parentSessionKey: parentSessionKey ?? null,
          } as { runId: string; sessionKey: string },
        };
      } catch (e) {
        const message = e instanceof Error ? e.message : String(e);
        log.warn({ err: e, errorMessage: message, workflow: definitionId }, `workflow start failed: ${message}`);
        return {
          content: [{ type: 'text', text: `workflow: ${message}` }],
          details: { error: message },
        };
      }
    },
  } as unknown as AgentTool;
}

function resolveDefinitionId(params: WorkflowToolInput, catalog: WorkflowCatalog): string {
  const name = params.name?.trim();
  if (name) {
    catalog.load(name);
    return name;
  }
  throw new Error('`name` is required. Create workflows in the visual workflow studio.');
}
