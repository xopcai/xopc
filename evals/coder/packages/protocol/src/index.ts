export const TRACE_SCHEMA_VERSION = 1 as const;

const SENSITIVE_KEY = /^(?:authorization|password|secret|cookie|token|api[_-]?key)$|(?:api|access|refresh|auth|oauth|bearer|bot)[_-]?token$/i;

export function redactText(value: string): string {
  return value
    .replace(/Bearer\s+[A-Za-z0-9._~+/=-]+/gi, 'Bearer [REDACTED]')
    .replace(/\b(?:sk|xox[baprs]|gh[opusr])[-_][A-Za-z0-9_-]{12,}\b/g, '[REDACTED]');
}

export function redactSensitive(value: unknown, key = ''): unknown {
  if (SENSITIVE_KEY.test(key)) return '[REDACTED]';
  if (typeof value === 'string') return redactText(value);
  if (Array.isArray(value)) return value.map((item) => redactSensitive(item));
  if (value && typeof value === 'object') {
    return Object.fromEntries(
      Object.entries(value).map(([childKey, child]) => [
        childKey,
        redactSensitive(child, childKey),
      ]),
    );
  }
  return value;
}

export type RunStatus =
  | 'queued'
  | 'running'
  | 'passed'
  | 'failed'
  | 'error'
  | 'timed_out'
  | 'budget_exceeded';

export type TraceEventType =
  | 'run.started'
  | 'environment.prepared'
  | 'prompt.built'
  | 'retrieval.query'
  | 'retrieval.result'
  | 'model.request'
  | 'model.response'
  | 'tool.started'
  | 'tool.finished'
  | 'workspace.changed'
  | 'verification.started'
  | 'verification.finished'
  | 'run.completed'
  | 'run.failed'
  | 'agent.event';

export interface TraceEvent {
  schemaVersion: typeof TRACE_SCHEMA_VERSION;
  eventId: string;
  runId: string;
  seq: number;
  timestamp: string;
  type: TraceEventType;
  payload: Record<string, unknown>;
  parentEventId?: string;
  artifactRefs?: string[];
}

export interface Artifact {
  id: string;
  runId: string;
  kind: string;
  sha256: string;
  path: string;
  sizeBytes: number;
  mimeType: string;
  createdAt: string;
}

export interface RunBudget {
  timeoutMs: number;
  maxModelRequests?: number;
  maxTokens?: number;
}

export interface AgentVariant {
  id: string;
  adapter: string;
  agentId?: string;
  model?: string;
  reasoning?: string;
  config?: Record<string, unknown>;
}

export interface RepoSanitizeSpec {
  enabled?: boolean;
  excludePaths?: string[];
}

export interface RepoSpec {
  source: 'local' | 'git';
  path?: string;
  url?: string;
  commit: string;
  sanitize?: RepoSanitizeSpec;
}

export type GraderCategory = 'correctness' | 'regression' | 'scope' | 'quality' | 'security';

export interface GraderPolicy {
  required?: boolean;
  weight?: number;
  category?: GraderCategory;
}

export interface HiddenFileSpec {
  /** Evaluator-side source path. Resolved relative to the Suite file when loaded. */
  source: string;
  /** Temporary path inside the evaluated workspace. */
  target: string;
}

export interface CommandGraderSpec extends GraderPolicy {
  type: 'command';
  command: string;
  timeoutMs?: number;
  hiddenFiles?: HiddenFileSpec[];
}

export interface UnchangedGraderSpec extends GraderPolicy {
  type: 'unchanged';
  paths: string[];
}

export interface FileContainsGraderSpec extends GraderPolicy {
  type: 'file_contains';
  path: string;
  text: string;
}

export type GraderSpec = CommandGraderSpec | UnchangedGraderSpec | FileContainsGraderSpec;

export interface EvalCase {
  id: string;
  title?: string;
  repo: RepoSpec;
  task: string;
  /** Environment/bootstrap commands. They must leave tracked source files unchanged. */
  prepare?: string[];
  /** Trusted commands that seed the task fixture and are committed before the agent runs. */
  setup?: string[];
  budget: RunBudget;
  graders: GraderSpec[];
  tags: string[];
}

export interface EvalSuite {
  id: string;
  version: string;
  description?: string;
  cases: EvalCase[];
  sourcePath: string;
  contentHash: string;
}

export interface ExperimentSpec {
  name: string;
  variants: AgentVariant[];
  repetitions?: number;
  randomizeVariantOrder?: boolean;
  randomSeed?: string;
}

export interface PreparedEnvironment {
  workspace: string;
  sourceCommit: string;
  fixtureCommit: string;
  metadata: Record<string, unknown>;
}

export interface RunRequest {
  runId: string;
  experimentId: string;
  evalCase: EvalCase;
  variant: AgentVariant;
  environment: PreparedEnvironment;
}

export interface AgentRunResult {
  status: 'completed' | 'failed' | 'aborted';
  finalText: string;
  sessionKey?: string;
  agentRunId?: string;
  usage?: Record<string, number>;
  runtimeIdentity?: Record<string, unknown>;
  error?: string;
}

export interface GradeResult {
  graderIndex: number;
  graderType: GraderSpec['type'];
  category: GraderCategory;
  required: boolean;
  weight: number;
  passed: boolean;
  score: number;
  summary: string;
  artifactRefs: string[];
  durationMs: number;
}

export interface EvalRunResult {
  runId: string;
  status: RunStatus;
  agent: AgentRunResult;
  grades: GradeResult[];
  score: number;
  artifactRefs: string[];
}

export interface AgentAdapter {
  readonly id: string;
  prepare?(request: RunRequest): Promise<void>;
  run(
    request: RunRequest,
    onEvent: (event: TraceEvent) => void | Promise<void>,
    signal: AbortSignal,
  ): Promise<AgentRunResult>;
  abort?(runId: string): Promise<void>;
  cleanup?(runId: string): Promise<void>;
}

export class TraceEmitter {
  private seq = 0;

  constructor(
    private readonly runId: string,
    private readonly sink: (event: TraceEvent) => void | Promise<void>,
  ) {}

  async emit(
    type: TraceEventType,
    payload: Record<string, unknown> = {},
    options: { parentEventId?: string; artifactRefs?: string[] } = {},
  ): Promise<TraceEvent> {
    const event: TraceEvent = {
      schemaVersion: TRACE_SCHEMA_VERSION,
      eventId: crypto.randomUUID(),
      runId: this.runId,
      seq: ++this.seq,
      timestamp: new Date().toISOString(),
      type,
      payload,
      ...(options.parentEventId ? { parentEventId: options.parentEventId } : {}),
      ...(options.artifactRefs?.length ? { artifactRefs: options.artifactRefs } : {}),
    };
    await this.sink(event);
    return event;
  }
}
