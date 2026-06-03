/**
 * Sandboxed workflow runtime.
 *
 * Parses the script via {@link parseWorkflowScript} (which strips the `meta`
 * export), wraps the remaining body in an async IIFE, and runs it inside a
 * Node `vm` context with a curated set of globals:
 *
 *   - `agent(prompt, opts)` — spawns a subagent through the injected
 *     {@link SubagentRunner} and returns its result (string, or schema-validated
 *     object). Failures resolve to `null`.
 *   - `parallel(thunks)` — concurrent fan-out; thunks (not promises!) so the
 *     limiter sees each agent() call.
 *   - `pipeline(items, ...stages)` — per-item sequential stages, items run
 *     concurrently (no stage barrier). Each stage receives
 *     `(prevResult, originalItem, index)`. A stage that throws drops that item
 *     to `null` and skips remaining stages.
 *   - `phase(title)` — marks the current phase; surfaces through `onPhase`.
 *   - `log(message)` — appends to the workflow log.
 *   - `budget` — `{ total, spent(), remaining() }` for self-pacing scripts.
 *   - `args`, `cwd`, `process.cwd()`.
 *
 * The runtime is the only code that touches `vm`. It exposes no IO surface,
 * carries no LLM dependency, and is fully driven by injected callbacks — that
 * means the workflow tool, tests, and any future runner share one runtime.
 */

import { availableParallelism } from 'node:os';
import { createContext, Script } from 'node:vm';

import { parseWorkflowScript } from './parser.js';
import type {
  AgentScriptOptions,
  SubagentRunner,
  WorkflowRunOptions,
  WorkflowRunResult,
  WorkflowSnapshot,
  WorkflowAgentStatus,
} from './types.js';

const DEFAULT_CONCURRENCY_FLOOR = 1;
const DEFAULT_CONCURRENCY_CEILING = 16;
const DEFAULT_MAX_SUBAGENTS = 1000;

interface RuntimeState {
  currentPhase?: string;
  logs: string[];
  phases: string[];
  agentCount: number;
  spent: number;
}

export interface RunWorkflowDeps {
  runner: SubagentRunner;
}

export async function runWorkflow<T = unknown>(
  script: string,
  deps: RunWorkflowDeps,
  options: WorkflowRunOptions,
): Promise<WorkflowRunResult<T>> {
  const started = Date.now();
  const { meta, body } = parseWorkflowScript(script);

  const state: RuntimeState = { logs: [], phases: [], agentCount: 0, spent: 0 };
  const concurrency = clampConcurrency(options.concurrency);
  const maxSubagents = Math.max(1, options.maxSubagents ?? DEFAULT_MAX_SUBAGENTS);
  const limiter = createLimiter(concurrency);
  const pendingAgentRuns = new Set<Promise<unknown>>();

  const log = (message: unknown) => {
    const text = String(message);
    state.logs.push(text);
    options.onLog?.(text);
  };

  const phase = (title: unknown) => {
    const text = requireString(title, 'phase title');
    state.currentPhase = text;
    if (!state.phases.includes(text)) state.phases.push(text);
    options.onPhase?.(text);
  };

  const budget = Object.freeze({
    total: options.tokenBudget ?? null,
    spent: () => state.spent,
    remaining: () =>
      options.tokenBudget == null
        ? Number.POSITIVE_INFINITY
        : Math.max(0, options.tokenBudget - state.spent),
  });

  const throwIfAborted = () => {
    if (options.signal?.aborted) throw new Error('workflow aborted');
  };

  const agent = async (prompt: unknown, agentOptions: unknown = {}) => {
    throwIfAborted();
    if (budget.total !== null && budget.remaining() <= 0) {
      throw new Error('workflow token budget exhausted');
    }
    if (state.agentCount >= maxSubagents) {
      throw new Error(`workflow agent quota exhausted (max ${maxSubagents})`);
    }

    const taskPrompt = requireString(prompt, 'agent prompt');
    const normalized = normalizeAgentOptions(agentOptions);
    const assignedPhase = normalized.phase ?? state.currentPhase;
    const requestedLabel = normalized.label?.trim();

    const runPromise = limiter(async () => {
      // Counter increments inside the limiter — id reflects start order, not enqueue order.
      state.agentCount += 1;
      const id = state.agentCount;
      const label = requestedLabel || defaultAgentLabel(assignedPhase, id);
      options.onAgentStart?.({ id, label, phase: assignedPhase, prompt: taskPrompt });

      try {
        throwIfAborted();
        const result = await deps.runner.run<unknown>(taskPrompt, {
          label,
          schema: normalized.schema,
          allowedToolNames: normalized.toolset,
          maxIterations: normalized.maxIterations,
          phase: assignedPhase,
          signal: options.signal,
          instructions: normalized.model
            ? `The parent workflow requested model "${normalized.model}".`
            : undefined,
        });
        throwIfAborted();

        const status: WorkflowAgentStatus = result === null ? 'error' : 'done';
        state.spent += estimateTokens(result);
        options.onAgentEnd?.({ id, label, phase: assignedPhase, result, status });
        return result;
      } catch (e) {
        if (options.signal?.aborted) {
          options.onAgentEnd?.({ id, label, phase: assignedPhase, result: null, status: 'skipped' });
          throw e;
        }
        const message = e instanceof Error ? e.message : String(e);
        log(`agent ${label} failed: ${message}`);
        options.onAgentEnd?.({ id, label, phase: assignedPhase, result: null, status: 'error' });
        return null;
      }
    });

    pendingAgentRuns.add(runPromise);
    // `then` (not `finally`) keeps the bookkeeping promise from re-throwing into
    // the unhandled-rejection channel when `runPromise` rejects on abort.
    runPromise.then(
      () => pendingAgentRuns.delete(runPromise),
      () => pendingAgentRuns.delete(runPromise),
    );
    return runPromise;
  };

  const parallel = async (thunks: unknown) => {
    throwIfAborted();
    if (!Array.isArray(thunks)) throw new TypeError('parallel() expects an array of functions');
    for (const t of thunks) {
      if (typeof t !== 'function') {
        throw new TypeError(
          'parallel() expects an array of functions, not promises. Wrap each call: () => agent(...)',
        );
      }
    }
    return Promise.all(
      thunks.map(async (thunk, index) => {
        try {
          return await (thunk as () => unknown)();
        } catch (e) {
          if (options.signal?.aborted) throw e;
          const message = e instanceof Error ? e.message : String(e);
          log(`parallel[${index}] failed: ${message}`);
          return null;
        }
      }),
    );
  };

  const pipeline = async (items: unknown, ...stages: Array<unknown>) => {
    throwIfAborted();
    if (!Array.isArray(items)) {
      throw new TypeError('pipeline() expects an array as the first argument');
    }
    for (const stage of stages) {
      if (typeof stage !== 'function') {
        throw new TypeError(
          'pipeline() stages must be functions: pipeline(items, item => ..., result => ...)',
        );
      }
    }
    const typedStages = stages as Array<
      (prev: unknown, original: unknown, index: number) => unknown
    >;
    return Promise.all(
      items.map(async (item, index) => {
        let value: unknown = item;
        for (const stage of typedStages) {
          try {
            throwIfAborted();
            value = await stage(value, item, index);
            throwIfAborted();
          } catch (e) {
            if (options.signal?.aborted) throw e;
            const message = e instanceof Error ? e.message : String(e);
            log(`pipeline[${index}] failed: ${message}`);
            return null;
          }
        }
        return value;
      }),
    );
  };

  const context = createContext({
    agent,
    parallel,
    pipeline,
    log,
    phase,
    args: options.args,
    cwd: options.cwd,
    process: Object.freeze({ cwd: () => options.cwd }),
    budget,
    console: {
      log,
      info: log,
      warn: (m: unknown) => log(`[warn] ${String(m)}`),
      error: (m: unknown) => log(`[error] ${String(m)}`),
    },
    JSON,
    Math,
    Array,
    Object,
    String,
    Number,
    Boolean,
    Set,
    Map,
    Promise,
  });

  const wrapped = `(async () => {\n${body}\n})()`;
  const script$ = new Script(wrapped, { filename: `${meta.name}.workflow.js` });

  let result: unknown;
  try {
    result = await script$.runInContext(context);
    // Wait for any agent() runs the script forgot to await before declaring success.
    await Promise.allSettled([...pendingAgentRuns]);
  } catch (e) {
    // Drain pending agent calls before propagating, so the snapshot reflects final state.
    await Promise.allSettled([...pendingAgentRuns]);
    throw e;
  }

  assertStructuredCloneable(result, 'workflow result');

  return {
    meta,
    result: result as T,
    logs: state.logs,
    phases: state.phases,
    agentCount: state.agentCount,
    durationMs: Date.now() - started,
  };
}

// ---------------------------------------------------------------------------
// Initial snapshot helper — kept here so the runtime is the single source of
// truth for "what a fresh snapshot looks like for this workflow".
// ---------------------------------------------------------------------------

export function emptySnapshotFor(name: string, description?: string): WorkflowSnapshot {
  return {
    name,
    description,
    phases: [],
    logs: [],
    agents: [],
    agentCount: 0,
    runningCount: 0,
    doneCount: 0,
    errorCount: 0,
    skippedCount: 0,
  };
}

// ---------------------------------------------------------------------------
// Internals
// ---------------------------------------------------------------------------

function clampConcurrency(requested?: number): number {
  if (typeof requested === 'number' && Number.isFinite(requested) && requested >= 1) {
    return Math.min(Math.floor(requested), DEFAULT_CONCURRENCY_CEILING);
  }
  let cpu = DEFAULT_CONCURRENCY_CEILING;
  try {
    cpu = availableParallelism();
  } catch {
    // Some sandboxes throw; fall back to the ceiling.
  }
  return Math.max(DEFAULT_CONCURRENCY_FLOOR, Math.min(DEFAULT_CONCURRENCY_CEILING, cpu - 2));
}

function createLimiter(limit: number) {
  let active = 0;
  const queue: Array<() => void> = [];
  const next = () => {
    active -= 1;
    const resume = queue.shift();
    if (resume) resume();
  };
  return async <T>(fn: () => Promise<T>): Promise<T> => {
    if (active >= limit) {
      await new Promise<void>((resolve) => queue.push(resolve));
    }
    active += 1;
    try {
      return await fn();
    } finally {
      next();
    }
  };
}

function requireString(value: unknown, name: string): string {
  if (typeof value !== 'string') throw new TypeError(`${name} must be a string`);
  return value;
}

function optionalString(value: unknown, name: string): string | undefined {
  if (value === undefined) return undefined;
  return requireString(value, name);
}

function normalizeAgentOptions(value: unknown): AgentScriptOptions {
  if (value === undefined || value === null) return {};
  if (typeof value !== 'object') throw new TypeError('agent options must be an object');
  const options = value as AgentScriptOptions;
  const toolset = options.toolset;
  if (toolset !== undefined) {
    if (!Array.isArray(toolset) || toolset.some((t) => typeof t !== 'string')) {
      throw new TypeError('agent toolset must be an array of strings');
    }
  }
  const maxIterations = options.maxIterations;
  if (maxIterations !== undefined) {
    if (typeof maxIterations !== 'number' || !Number.isFinite(maxIterations) || maxIterations < 1) {
      throw new TypeError('agent maxIterations must be a positive number');
    }
  }
  return {
    label: optionalString(options.label, 'agent label'),
    phase: optionalString(options.phase, 'agent phase'),
    schema: options.schema,
    model: optionalString(options.model, 'agent model'),
    toolset,
    maxIterations,
  };
}

function assertStructuredCloneable(value: unknown, name: string): void {
  try {
    structuredClone(value);
  } catch (e) {
    const detail = e instanceof Error ? ` ${e.message}` : '';
    throw new Error(
      `${name} must be structured-cloneable; did you forget to await agent(), parallel(), or pipeline()?${detail}`,
    );
  }
}

function defaultAgentLabel(phase: string | undefined, index: number): string {
  return phase ? `${phase} agent ${index}` : `agent ${index}`;
}

function estimateTokens(value: unknown): number {
  if (value === null || value === undefined) return 0;
  try {
    return Math.ceil(JSON.stringify(value).length / 4);
  } catch {
    return Math.ceil(String(value).length / 4);
  }
}
