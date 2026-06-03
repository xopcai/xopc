/**
 * Shared types for the workflow runtime.
 *
 * The runtime depends only on `SubagentRunner` — the adapter that wraps the
 * concrete child-agent factory lives in `subagent-runner.ts`. This keeps
 * `runtime.ts` free of any LLM-stack imports and makes alternate runners
 * (remote agents, test doubles) drop-in replacements.
 */

import type { Model, Api } from '@earendil-works/pi-ai';

/** Plain JSON Schema (no TypeBox brand). Mirrors the shape models emit verbatim. */
export interface JsonSchema {
  type?: string | string[];
  properties?: Record<string, JsonSchema>;
  items?: JsonSchema | JsonSchema[];
  required?: string[];
  additionalProperties?: boolean | JsonSchema;
  enum?: unknown[];
  const?: unknown;
  description?: string;
  [key: string]: unknown;
}

export interface WorkflowMetaPhase {
  title: string;
  detail?: string;
  model?: string;
}

export interface WorkflowMetaEstimatedAgents {
  min: number;
  max: number;
}

export interface WorkflowMeta {
  name: string;
  description: string;
  whenToUse?: string;
  phases?: WorkflowMetaPhase[];
  /** Discovery tags, e.g. `['code-review', 'planning']`. */
  tags?: string[];
  /** Rough subagent count range for UX / cost hints. */
  estimatedAgents?: WorkflowMetaEstimatedAgents;
}

export type WorkflowAgentStatus = 'queued' | 'running' | 'done' | 'error' | 'skipped';

export interface WorkflowAgentSnapshot {
  id: number;
  label: string;
  phase?: string;
  prompt: string;
  status: WorkflowAgentStatus;
  resultPreview?: string;
  error?: string;
}

export interface WorkflowSnapshot {
  name: string;
  description?: string;
  phases: string[];
  currentPhase?: string;
  logs: string[];
  agents: WorkflowAgentSnapshot[];
  agentCount: number;
  runningCount: number;
  doneCount: number;
  errorCount: number;
  skippedCount: number;
  durationMs?: number;
  result?: unknown;
}

export interface SubagentRunOptions<T = unknown> {
  label: string;
  /** When set, the subagent must return a value matching the schema (validated via ajv). */
  schema?: JsonSchema;
  /** Per-agent overrides; defaults filled by the runner adapter. */
  allowedToolNames?: string[];
  maxIterations?: number;
  /** Resolved model. When omitted the adapter falls back to the workflow-level default. */
  model?: Model<Api>;
  signal?: AbortSignal;
  /** Extra guidance prepended to the subagent prompt. */
  instructions?: string;
  /** When false (default), failures resolve to `null`; when true, errors propagate. */
  rethrow?: boolean;
  /** Hint about which phase this agent belongs to (passed through for logging). */
  phase?: string;
  /** Pre-bound capture for structured output (internal: created by the adapter when schema present). */
  __capture?: { called: boolean; value?: T };
}

/**
 * Spawns a single fresh subagent and returns its result.
 *
 * - Without `schema`: returns the final assistant text (`string`).
 * - With `schema`: returns the value the subagent passed to the injected
 *   `structured_output` tool (validated, typed as `T`).
 *
 * Returns `null` when the subagent fails or aborts — runtime keeps going.
 */
export interface SubagentRunner {
  run<T = string>(prompt: string, opts: SubagentRunOptions<T>): Promise<T | null>;
}

/** Options accepted by `agent()` inside a workflow script. */
export interface AgentScriptOptions {
  label?: string;
  phase?: string;
  schema?: JsonSchema;
  /** Model id; currently passed as text guidance, runner may resolve in future. */
  model?: string;
  /** Subagent tool allowlist override (forwarded to the runner). */
  toolset?: string[];
  /** Max tool iterations inside the subagent. */
  maxIterations?: number;
}

export interface WorkflowRunOptions {
  args?: unknown;
  cwd: string;
  signal?: AbortSignal;
  /** Hard upper bound on concurrent subagents (default min(16, cpu-2)). */
  concurrency?: number;
  /** Total token budget exposed to script via `budget`. `null` = unlimited. */
  tokenBudget?: number | null;
  /** Hard cap on total subagent count for one workflow run (default 1000). */
  maxSubagents?: number;
  onLog?: (message: string) => void;
  onPhase?: (title: string) => void;
  onAgentStart?: (event: { id: number; label: string; phase?: string; prompt: string }) => void;
  onAgentEnd?: (event: { id: number; label: string; phase?: string; result: unknown; status: WorkflowAgentStatus }) => void;
}

export interface WorkflowRunResult<T = unknown> {
  meta: WorkflowMeta;
  result: T;
  logs: string[];
  phases: string[];
  agentCount: number;
  durationMs: number;
}
