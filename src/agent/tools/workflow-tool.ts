/**
 * `workflow` — starts a persisted workflow run in a dedicated chat session.
 */

import { Type } from '@sinclair/typebox';
import type { AgentTool, AgentToolResult } from '@earendil-works/pi-agent-core';
import {
  appendProductDeliveryText,
  type ProductDeliveryEnvelope,
} from '@xopcai/gateway-contract';

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
  outcomeId: Type.Optional(
    Type.String({
      description: 'Optional Outcome id. When set, terminal workflow output advances that outcome.',
    }),
  ),
});

export type WorkflowToolInput = {
  name?: string;
  args?: unknown;
  goal?: string;
  outcomeId?: string;
};

export interface WorkflowToolDeps {
  catalog: WorkflowCatalog;
  getCurrentSessionKey?: () => string | undefined;
  getConfig: () => import('../../config/schema.js').Config | undefined;
  startWorkflowRun?: (params: StartWorkflowRunServiceParams) => Promise<WorkflowRunServiceResult>;
}

type WorkflowToolDetails =
  | {
      runId: string;
      sessionKey: string;
      definitionId: string;
      parentSessionKey: string | null;
      delivery: ProductDeliveryEnvelope;
    }
  | { error: string };

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
    ): Promise<AgentToolResult<WorkflowToolDetails>> {
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
      const outcomeId = params.outcomeId?.trim();
      const source = parentSessionKey
        ? ({ kind: 'chat' as const, sessionKey: parentSessionKey })
        : ({ kind: 'api' as const });
      const inputEnvelope = outcomeId
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
          outcomeId,
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
        const delivery: ProductDeliveryEnvelope = {
          version: 1,
          operation: 'started',
          primary: {
            kind: 'workflow_run',
            id: result.runId,
            title: goal || definitionId,
            summary: `Workflow ${definitionId}`,
            status: 'running',
            capabilities: ['open', 'continue_in_chat'],
          },
          related: [
            {
              kind: 'workflow_definition',
              id: definitionId,
              title: definitionId,
              capabilities: ['open', 'edit', 'run'],
            },
            {
              kind: 'session',
              id: result.sessionKey,
              title: goal || definitionId,
              capabilities: ['open', 'continue_in_chat'],
            },
          ],
        };

        return {
          content: [
            {
              type: 'text',
              text: appendProductDeliveryText(
                `${summary}\n\nsessionKey: ${result.sessionKey}`,
                delivery,
              ),
            },
          ],
          details: {
            runId: result.runId,
            sessionKey: result.sessionKey,
            definitionId,
            parentSessionKey: parentSessionKey ?? null,
            delivery,
          },
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
