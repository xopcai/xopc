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
  /** Default model for this phase: `provider/model` or configured typed id. */
  model?: string;
}

export interface WorkflowMetaEstimatedAgents {
  min: number;
  max: number;
}

/** One-click starter text in the gateway start dialog; `field` is `goal` or an `args` key. */
export interface WorkflowMetaExamplePrompt {
  field: string;
  text: string;
}

/** Locale-specific copy overrides; top-level `description` / `whenToUse` / `examplePrompts` are English defaults. */
export interface WorkflowMetaLocale {
  description?: string;
  whenToUse?: string;
  examplePrompts?: WorkflowMetaExamplePrompt[];
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
  /** English-default example prompts for the gateway start dialog. */
  examplePrompts?: WorkflowMetaExamplePrompt[];
  /** Non-English locale bundles keyed by BCP-47 language tag (e.g. `zh`). */
  i18n?: Record<string, WorkflowMetaLocale>;
}

export type WorkflowAgentStatus = 'queued' | 'running' | 'done' | 'error' | 'skipped';

export type WorkflowAgentStepStatus = 'running' | 'done' | 'error';

export interface WorkflowAgentStep {
  id: string;
  kind: 'tool' | 'llm' | 'thinking';
  /** Original tool name when `kind === 'tool'` (for chat UI reuse). */
  toolName?: string;
  label: string;
  detail?: string;
  status: WorkflowAgentStepStatus;
  resultPreview?: string;
  error?: string;
  startedAtMs?: number;
  durationMs?: number;
}

export interface WorkflowAgentSnapshot {
  id: number;
  label: string;
  phase?: string;
  prompt: string;
  status: WorkflowAgentStatus;
  resultPreview?: string;
  error?: string;
  startedAtMs?: number;
  durationMs?: number;
  steps?: WorkflowAgentStep[];
  /** One-line summary for inline agent rows. */
  currentStep?: string;
  iteration?: number;
  maxIterations?: number;
  /** Accumulated assistant/thinking text when subagentStream is `full`. */
  streamText?: string;
}

export interface WorkflowAgentInvocationSnapshot {
  prompt: string;
  label: string;
  phase?: string;
  modelRef?: string;
  resolvedModelRef?: string;
  schema?: JsonSchema;
  toolset?: string[];
  maxIterations?: number;
}

export interface WorkflowSnapshot {
  runId?: string;
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
  /** Persistent hidden session for this workflow subagent. */
  sessionKey?: string;
  sessionMetadata?: {
    parentSessionKey?: string;
    workflowRunId: string;
    workflowDefinitionId: string;
    workflowAgentId: string;
    workflowAgentLabel: string;
  };
  /** Live progress from the child agent loop (workflow tool binds per agent id). */
  onProgress?: (event: SubagentProgressEvent) => void;
  /** Pre-bound capture for structured output (internal: created by the adapter when schema present). */
  __capture?: { called: boolean; value?: T };
}

export type SubagentProgressEvent =
  | { type: 'tool_start'; toolCallId: string; toolName: string; args: Record<string, unknown> }
  | {
      type: 'tool_end';
      toolCallId: string;
      toolName: string;
      isError: boolean;
      resultPreview?: string;
      error?: string;
    }
  | { type: 'iteration'; count: number; max: number }
  | { type: 'text_delta'; delta: string }
  | { type: 'thinking_delta'; delta: string };

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
  /**
   * Model ref: `provider/model` or a configured typed id (e.g. `small`, `@large`).
   */
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
  onAgentQueued?: (event: {
    id: number;
    label: string;
    phase?: string;
    prompt: string;
    invocation: WorkflowAgentInvocationSnapshot;
  }) => void;
  onAgentStart?: (event: { id: number; label: string; phase?: string; prompt: string }) => void;
  onAgentEnd?: (event: { id: number; label: string; phase?: string; result: unknown; status: WorkflowAgentStatus }) => void;
  /** Merge extra subagent run options (e.g. progress callbacks) per agent id. */
  enhanceSubagentRun?: (ctx: {
    id: number;
    label: string;
    phase?: string;
    prompt: string;
  }) => Partial<SubagentRunOptions<unknown>>;
}

export interface WorkflowRunResult<T = unknown> {
  meta: WorkflowMeta;
  result: T;
  logs: string[];
  phases: string[];
  agentCount: number;
  durationMs: number;
}
