/**
 * `workflow` — starts a persisted workflow run in a dedicated chat session.
 */

import { Type } from '@sinclair/typebox';
import type { AgentTool, AgentToolResult } from '@earendil-works/pi-agent-core';

import { extractProfileAgentId } from '../../config/agent-profile.js';
import { createLogger } from '../../utils/logger.js';
import { parseWorkflowScript } from '../workflow/index.js';
import type { WorkflowCatalog } from '../workflow/catalog.js';
import type {
  StartWorkflowRunServiceParams,
  WorkflowRunServiceResult,
} from '../../workflows/service/workflow-run-service.js';

const log = createLogger('workflow-tool');

const WorkflowToolSchema = Type.Object({
  name: Type.Optional(
    Type.String({
      description:
        'Name of a saved workflow to run. Either `name` or `script` is required. ' +
        'Use `name` whenever the user references a known workflow (built-in or in ~/.xopc/workflows/).',
    }),
  ),
  script: Type.Optional(
    Type.String({
      description: [
        'Raw JavaScript workflow script (no Markdown fences, no TypeScript syntax). Ignored when `name` is set.',
        "First statement: export const meta = { name: 'snake_case', description: 'short, human-readable' }.",
      ].join(' '),
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
});

export type WorkflowToolInput = {
  name?: string;
  script?: string;
  args?: unknown;
  goal?: string;
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
      'Use `name` for catalog workflows, or `script` for an inline workflow (saved under meta.name before run).',
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
      const source = parentSessionKey
        ? ({ kind: 'chat' as const, sessionKey: parentSessionKey })
        : ({ kind: 'api' as const });

      try {
        const result = await deps.startWorkflowRun({
          agentId,
          definitionId,
          goal,
          input: params.args,
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
  if (!params.script?.trim()) {
    throw new Error('either `name` or `script` is required.');
  }
  const script = normalizeScript(params.script);
  const meta = parseWorkflowScript(script).meta;
  catalog.save(meta.name, script);
  return meta.name;
}

function normalizeScript(script: string): string {
  let text = script.trim();
  const fence = text.match(/^```(?:js|javascript)?\s*\n([\s\S]*?)\n```$/i);
  if (fence) text = fence[1].trim();
  return text;
}
