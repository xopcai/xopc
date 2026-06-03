/**
 * `workflow` — the AgentTool the parent model calls to spawn a fan-out run.
 *
 * Shape mirrors `delegate-tool`: factory builds a closure over deps; `execute`
 * parses the script, instantiates the {@link DelegateSubagentRunner}, drives the
 * {@link runWorkflow} runtime, and pushes a live text snapshot through
 * `onUpdate` for streaming UIs (TUI, gateway console).
 *
 * Why this lives in `src/agent/tools/` (not under `src/agent/workflow/`):
 * the runtime is reusable infrastructure; the AgentTool wrapping is a
 * presentation concern that depends on the AgentToolsFactory wiring. Keeping
 * the wrapper here matches how `delegate-tool` and `execute-code-tool` are
 * organised today.
 */

import { Type } from '@sinclair/typebox';
import type { AgentTool, AgentToolResult } from '@earendil-works/pi-agent-core';
import type { Api, Model } from '@earendil-works/pi-ai';

import type { Config } from '../../config/schema.js';
import type { MessageBus } from '../../infra/bus/index.js';
import { createLogger } from '../../utils/logger.js';

import type { BuildChildToolsOptions } from '../child-agent-factory.js';
import {
  DelegateSubagentRunner,
  getLastWorkflowMemory,
  parseWorkflowScript,
  previewValue,
  recomputeCounts,
  renderWorkflowText,
  runWorkflow,
  type WorkflowAgentSnapshot,
  type WorkflowCatalog,
  type WorkflowMeta,
  type WorkflowSnapshot,
} from '../workflow/index.js';
import type { ToolExecutorConfig } from './executor.js';

const log = createLogger('workflow-tool');

const DEFAULT_TIMEOUT_SEC = 30 * 60;
const MAX_TIMEOUT_SEC = 4 * 60 * 60;
const DEFAULT_MAX_CONCURRENCY = 16;
const DEFAULT_MAX_SUBAGENTS = 1000;

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
        'Use phase(title), agent(prompt, opts), parallel(arrayOfFunctions), pipeline(items, ...stages), log(message), args, and budget.',
        'The script must call agent() at least once.',
        'parallel() requires functions: await parallel(items.map(item => () => agent(...))).',
      ].join(' '),
    }),
  ),
  args: Type.Optional(
    Type.Any({
      description: 'Optional JSON value exposed to the workflow script as the global `args`.',
    }),
  ),
});

export type WorkflowToolInput = {
  name?: string;
  script?: string;
  args?: unknown;
};

export interface WorkflowToolDeps {
  workspace: string;
  bus: MessageBus;
  /** Returns the parent agent's primary model — subagents default to this. */
  getSubagentModel: () => Model<Api>;
  getConfig: () => Config | undefined;
  /** Same injection point delegate-tool uses; supplied by AgentToolsFactory. */
  buildChildTools: (opts: BuildChildToolsOptions) => AgentTool<any, any>[];
  toolExecutorConfig?: Partial<ToolExecutorConfig>;
  /** Catalog for `name` lookups (built-in + ~/.xopc/workflows/). */
  catalog: WorkflowCatalog;
  /** Per-call sessionKey lookup — used to record "last successful workflow" for /workflow save. */
  getCurrentSessionKey?: () => string | undefined;
}

export function createWorkflowTool(deps: WorkflowToolDeps): AgentTool {
  return {
    name: 'workflow',
    label: '◆ Workflow',
    description: [
      'Run a deterministic JavaScript workflow that orchestrates multiple isolated subagents through agent(), parallel(), and pipeline().',
      'Two ways to invoke:',
      '  1. `name`: run a saved workflow from the catalog (built-in or ~/.xopc/workflows/). Prefer this when the user references a known name.',
      '  2. `script`: provide a raw JS workflow inline. Use when no saved workflow fits. Header is required: export const meta = { name, description }.',
      'Named-workflow triggers — call this tool with `{ name: "<name>" }` IMMEDIATELY when the user message is any of:',
      '  • a bare workflow name like "/audit_repo", "/pr_review", "/research", or "audit_repo"',
      '  • "run the audit_repo workflow", "review this PR", "debug this error", "kick off research", "do a multi_perspective_review on X" (extract args when natural: target, question, error, diff)',
      '  • after /workflows lists saved workflows and the user picks one',
      'Use phase(title) at runtime to mark progress groups. Each agent() returns a string, or a schema-validated object when opts.schema is set.',
      'Prefer for decomposable work: repo audits, PR review, incident triage, multi-perspective review, fan-out research, large refactors. Do not use for a single quick read/edit.',
      'parallel() takes thunks, not promises: parallel(items.map(item => () => agent(...))).',
      'pipeline(items, ...stages) interleaves items across stages — fastest path by default; only use parallel() when you genuinely need a cross-item barrier.',
      'Failed agent()/parallel()/pipeline() entries resolve to null; check before synthesizing.',
      'Do not use Date.now(), Math.random(), new Date(), require, import, fs, or network APIs — they are unavailable for determinism.',
      'Always end with a synthesis agent() that consolidates findings, especially when you fan out for review or research.',
    ].join('\n\n'),
    parameters: WorkflowToolSchema,

    async execute(
      _toolCallId: string,
      params: WorkflowToolInput,
      signal?: AbortSignal,
      onUpdate?: (update: AgentToolResult<WorkflowSnapshot | undefined>) => void,
    ): Promise<AgentToolResult<WorkflowSnapshot | { error: string }>> {
      let script: string;
      let resolvedSource: 'name' | 'script' = 'script';
      try {
        const resolved = resolveScript(params, deps.catalog);
        script = resolved.script;
        resolvedSource = resolved.source;
      } catch (e) {
        const message = e instanceof Error ? e.message : String(e);
        return {
          content: [{ type: 'text', text: `workflow: ${message}` }],
          details: { error: message },
        };
      }

      const cfg = deps.getConfig();
      const wfCfg = cfg?.agents?.defaults?.workflow;
      const concurrency = wfCfg?.maxConcurrency ?? DEFAULT_MAX_CONCURRENCY;
      const maxSubagents = wfCfg?.maxSubagents ?? DEFAULT_MAX_SUBAGENTS;
      const timeoutSec = clampTimeout(wfCfg?.defaultTimeoutSec);

      // Parse early so a bad script returns an error result instead of throwing
      // through the agent loop. The runtime parses again, but that's cheap.
      let meta: WorkflowMeta;
      try {
        meta = parseWorkflowScript(script).meta;
      } catch (e) {
        const message = e instanceof Error ? e.message : String(e);
        return {
          content: [
            {
              type: 'text',
              text:
                resolvedSource === 'name'
                  ? `workflow "${params.name}" failed to parse: ${message}`
                  : `workflow parse error: ${message}`,
            },
          ],
          details: { error: message },
        };
      }

      const snapshot: WorkflowSnapshot = {
        name: meta.name,
        description: meta.description,
        phases: [],
        logs: [],
        agents: [],
        agentCount: 0,
        runningCount: 0,
        doneCount: 0,
        errorCount: 0,
        skippedCount: 0,
      };

      const pushUpdate = (completed = false) => {
        recomputeCounts(snapshot);
        onUpdate?.({
          content: [
            {
              type: 'text',
              text: renderWorkflowText(snapshot, completed, { showResultPreviews: false }),
            },
          ],
          details: snapshot,
        });
      };

      const runner = new DelegateSubagentRunner({
        workspace: deps.workspace,
        bus: deps.bus,
        getDefaultModel: deps.getSubagentModel,
        getConfig: deps.getConfig,
        toolExecutorConfig: deps.toolExecutorConfig,
        buildChildTools: deps.buildChildTools,
      });

      // Combined abort: parent signal + per-run timeout.
      const controller = new AbortController();
      const onParentAbort = () => controller.abort();
      signal?.addEventListener('abort', onParentAbort, { once: true });
      const timeoutHandle =
        timeoutSec > 0
          ? setTimeout(() => controller.abort(), timeoutSec * 1000)
          : undefined;

      pushUpdate();

      try {
        const result = await runWorkflow(script, { runner }, {
          cwd: deps.workspace,
          args: params.args,
          signal: controller.signal,
          concurrency,
          maxSubagents,
          onLog: (message) => {
            snapshot.logs.push(message);
            pushUpdate();
          },
          onPhase: (title) => {
            snapshot.currentPhase = title;
            if (!snapshot.phases.includes(title)) snapshot.phases.push(title);
            pushUpdate();
          },
          onAgentStart: (event) => {
            snapshot.agents.push({
              id: event.id,
              label: event.label,
              phase: event.phase,
              prompt: event.prompt,
              status: 'running',
            });
            pushUpdate();
          },
          onAgentEnd: (event) => {
            const agent = findAgentById(snapshot.agents, event.id);
            if (agent) {
              agent.status = event.status;
              agent.resultPreview = previewValue(event.result);
            }
            pushUpdate();
          },
        });

        if (result.agentCount === 0) {
          const reason =
            'workflow scripts must call agent() at least once; this workflow declared phases but never ran a subagent.';
          snapshot.logs.push(reason);
          pushUpdate(true);
          return {
            content: [{ type: 'text', text: reason }],
            details: snapshot,
          };
        }

        snapshot.result = result.result;
        snapshot.durationMs = result.durationMs;
        pushUpdate(true);

        // Record for /workflow save — last successful run per session.
        // Failures are intentionally skipped so users do not save broken scripts.
        try {
          getLastWorkflowMemory().record(deps.getCurrentSessionKey?.(), {
            script,
            metaName: result.meta.name,
            source: resolvedSource,
            recordedAt: Date.now(),
          });
        } catch {
          // Memory recording is best-effort; never break a successful run on it.
        }

        return {
          content: [
            {
              type: 'text',
              text: `workflow ${result.meta.name} completed: ${result.agentCount} subagent(s), ${snapshot.errorCount} error(s).\n\nResult:\n${safeStringify(result.result)}`,
            },
          ],
          details: snapshot,
        };
      } catch (e) {
        if (controller.signal.aborted) {
          for (const a of snapshot.agents) {
            if (a.status === 'running') {
              a.status = 'skipped';
              a.error = 'aborted';
            }
          }
          pushUpdate(true);
          const reason = signal?.aborted ? 'workflow aborted' : `workflow timed out after ${timeoutSec}s`;
          return {
            content: [{ type: 'text', text: reason }],
            details: snapshot,
          };
        }
        const message = e instanceof Error ? e.message : String(e);
        log.warn({ err: e, errorMessage: message, workflow: meta.name }, `workflow failed: ${message}`);
        snapshot.logs.push(`workflow failed: ${message}`);
        pushUpdate(true);
        return {
          content: [{ type: 'text', text: `workflow failed: ${message}` }],
          details: snapshot,
        };
      } finally {
        if (timeoutHandle) clearTimeout(timeoutHandle);
        signal?.removeEventListener('abort', onParentAbort);
      }
    },
  } as unknown as AgentTool;
}

// ---------------------------------------------------------------------------

function normalizeScript(script: string): string {
  let text = script.trim();
  const fence = text.match(/^```(?:js|javascript)?\s*\n([\s\S]*?)\n```$/i);
  if (fence) text = fence[1].trim();
  return text;
}

function resolveScript(
  params: WorkflowToolInput,
  catalog: WorkflowCatalog,
): { script: string; source: 'name' | 'script' } {
  const name = params.name?.trim();
  if (name) {
    const loaded = catalog.load(name);
    return { script: loaded.script, source: 'name' };
  }
  if (!params.script || !params.script.trim()) {
    throw new Error('either `name` or `script` is required.');
  }
  return { script: normalizeScript(params.script), source: 'script' };
}

function clampTimeout(requested: number | undefined): number {
  const v = typeof requested === 'number' && Number.isFinite(requested) ? requested : DEFAULT_TIMEOUT_SEC;
  if (v <= 0) return 0;
  return Math.min(MAX_TIMEOUT_SEC, Math.max(1, Math.floor(v)));
}

function findAgentById(agents: WorkflowAgentSnapshot[], id: number): WorkflowAgentSnapshot | undefined {
  // Linear scan — agent lists are small in practice (capped at maxSubagents).
  for (let i = agents.length - 1; i >= 0; i--) {
    if (agents[i].id === id) return agents[i];
  }
  return undefined;
}

function safeStringify(value: unknown): string {
  try {
    return JSON.stringify(value, null, 2);
  } catch {
    return String(value);
  }
}
