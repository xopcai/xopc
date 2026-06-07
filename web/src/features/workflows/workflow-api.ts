import { fetchJson } from '@/lib/fetch';
import { apiUrl } from '@/lib/url';

export type WorkflowRunStatus = 'queued' | 'running' | 'succeeded' | 'failed' | 'cancelled' | 'timeout';
export type WorkflowPhaseStatus = 'pending' | 'running' | 'completed' | 'failed';
export type WorkflowAgentStatus = 'queued' | 'running' | 'done' | 'error' | 'skipped';

export interface WorkflowDefinitionEstimatedAgents {
  min: number;
  max: number;
}

export interface WorkflowDefinition {
  id: string;
  name: string;
  title: string;
  description: string;
  version: string;
  phases: WorkflowPhaseDefinition[];
  runtime?: WorkflowRuntimeDefinition;
  defaults: WorkflowDefinitionDefaults;
  metadata: WorkflowDefinitionMetadata;
}

export interface WorkflowRuntimeDefinition {
  kind: 'script';
  source: string;
}

export interface WorkflowPhaseDefinition {
  id: string;
  title: string;
  description?: string;
}

export interface WorkflowDefinitionDefaults {
  concurrency: number;
  timeoutSec: number;
  maxSubagents: number;
}

export interface WorkflowDefinitionMetadata {
  tags: string[];
  builtIn: boolean;
  source: 'builtin' | 'user';
  whenToUse?: string;
  estimatedAgents?: WorkflowDefinitionEstimatedAgents;
  examplePrompts?: WorkflowDefinitionExamplePrompt[];
  i18n?: Record<string, WorkflowDefinitionLocaleBundle>;
  createdAtMs: number;
  updatedAtMs: number;
}

export interface WorkflowDefinitionExamplePrompt {
  field: string;
  text: string;
}

export interface WorkflowDefinitionLocaleBundle {
  description?: string;
  whenToUse?: string;
  examplePrompts?: WorkflowDefinitionExamplePrompt[];
}

export interface WorkflowRunMetrics {
  agentCount: number;
  doneAgentCount: number;
  errorAgentCount: number;
  skippedAgentCount: number;
  artifactCount: number;
  durationMs?: number;
}

export type WorkflowRunSource =
  | { kind: 'chat'; sessionKey: string; messageId?: string }
  | { kind: 'webui'; sessionKey?: string; requestId?: string }
  | { kind: 'cron'; scheduleId: string; fireId?: string; scheduledAtMs?: number }
  | { kind: 'api'; requestId?: string; idempotencyKey?: string }
  | { kind: 'im'; channel: string; chatId: string; messageId?: string; userId?: string }
  | Record<string, unknown>;

export interface WorkflowRunMetadata {
  sessionKey: string;
  triggerSource: string;
  agentId?: string;
  retryOfRunId?: string;
  definition: WorkflowRunDefinitionSnapshot;
  input?: WorkflowRunInputEnvelope;
  correlation?: WorkflowRunCorrelation;
  origin?: WorkflowRunOrigin;
  schedule?: WorkflowRunScheduleMetadata;
}

export interface WorkflowRunInputEnvelope {
  payload: unknown;
  goal?: string;
  variables?: Record<string, unknown>;
  context?: Record<string, unknown>;
}

export interface WorkflowRunCorrelation {
  idempotencyKey?: string;
  requestId?: string;
  traceId?: string;
  parentRunId?: string;
}

export interface WorkflowRunOrigin {
  channel: string;
  sessionKey?: string;
  chatId?: string;
  messageId?: string;
  scheduleId?: string;
  fireId?: string;
  requestId?: string;
}

export interface WorkflowRunScheduleMetadata {
  scheduleId: string;
  fireId?: string;
  scheduledAtMs?: number;
}

export interface WorkflowRunDefinitionSnapshot {
  id: string;
  name: string;
  title: string;
  version: string;
  source: 'builtin' | 'user';
  tags: string[];
  phaseCount: number;
  estimatedAgents?: WorkflowDefinitionEstimatedAgents;
}

export interface WorkflowRunSummary {
  id: string;
  definitionId: string;
  title: string;
  status: WorkflowRunStatus;
  source: WorkflowRunSource;
  metadata?: WorkflowRunMetadata;
  createdAtMs: number;
  startedAtMs?: number;
  completedAtMs?: number;
  metrics: WorkflowRunMetrics;
}

export interface WorkflowRun {
  id: string;
  definitionId: string;
  definitionVersion: string;
  title: string;
  goal: string;
  input: unknown;
  status: WorkflowRunStatus;
  source: WorkflowRunSource;
  metadata?: WorkflowRunMetadata;
  result?: unknown;
  error?: { code: string; message: string; detail?: string; recoverable: boolean };
  metrics: WorkflowRunMetrics;
  createdAtMs: number;
  startedAtMs?: number;
  completedAtMs?: number;
}

export interface WorkflowPhaseView {
  id: string;
  title: string;
  status: WorkflowPhaseStatus;
  startedAtMs?: number;
  completedAtMs?: number;
  agentIds: string[];
}

export interface WorkflowAgentView {
  id: string;
  label: string;
  phaseId?: string;
  status: WorkflowAgentStatus;
  prompt?: string;
  currentStep?: string;
  resultPreview?: string;
  error?: string;
  startedAtMs?: number;
  completedAtMs?: number;
  steps?: Array<{
    id: string;
    label: string;
    kind: 'tool' | 'llm' | 'thinking';
    detail?: string;
    status: 'running' | 'done' | 'error';
    startedAtMs?: number;
    completedAtMs?: number;
  }>;
}

export interface WorkflowLogEntry {
  sequence: number;
  message: string;
  createdAtMs: number;
}

export interface WorkflowRunView {
  run: WorkflowRun;
  phases: WorkflowPhaseView[];
  agents: WorkflowAgentView[];
  logs: WorkflowLogEntry[];
  artifacts: unknown[];
  timeline: Array<{ sequence: number; type: string; title: string; createdAtMs: number }>;
  controls: { canCancel: boolean; canRetry: boolean; canArchive: boolean };
}

export interface WorkflowStats {
  totalRuns: number;
  activeRuns: number;
  succeededRuns: number;
  failedRuns: number;
  averageDurationMs: number | null;
  topDefinitions: Array<{ definitionId: string; count: number }>;
}

export interface StartWorkflowRunOptions {
  definitionId: string;
  goal?: string;
  input?: unknown;
  agentId?: string;
  sessionKey?: string;
  concurrency?: number;
  maxSubagents?: number;
  tokenBudget?: number | null;
}

export type WorkflowDefinitionValidationIssueCode =
  | 'name_required'
  | 'script_required'
  | 'parse_failed'
  | 'meta_name_mismatch'
  | 'unknown_error';

export interface WorkflowDefinitionValidationIssue {
  code: WorkflowDefinitionValidationIssueCode;
  message: string;
  line?: number;
  column?: number;
}

export interface ValidateWorkflowDefinitionResponse {
  valid: boolean;
  errors: WorkflowDefinitionValidationIssue[];
  warnings: WorkflowDefinitionValidationIssue[];
  definition?: WorkflowDefinition;
}

export async function listWorkflowDefinitions(): Promise<WorkflowDefinition[]> {
  const data = await fetchJson<{ definitions: WorkflowDefinition[] }>(apiUrl('/api/workflows/definitions'));
  return data.definitions ?? [];
}

export async function getWorkflowDefinition(id: string): Promise<WorkflowDefinition> {
  const data = await fetchJson<{ definition: WorkflowDefinition }>(
    apiUrl(`/api/workflows/definitions/${encodeURIComponent(id)}`),
  );
  return data.definition;
}

export async function validateWorkflowDefinition(
  name: string,
  script: string,
): Promise<ValidateWorkflowDefinitionResponse> {
  return fetchJson<ValidateWorkflowDefinitionResponse>(apiUrl('/api/workflows/definitions/validate'), {
    method: 'POST',
    body: JSON.stringify({ name, script }),
  });
}

export async function saveWorkflowDefinition(name: string, script: string): Promise<WorkflowDefinition> {
  const data = await fetchJson<{ definition: WorkflowDefinition }>(apiUrl('/api/workflows/definitions'), {
    method: 'POST',
    body: JSON.stringify({ name, script }),
  });
  return data.definition;
}

export async function deleteWorkflowDefinition(id: string): Promise<void> {
  await fetchJson(apiUrl(`/api/workflows/definitions/${encodeURIComponent(id)}`), { method: 'DELETE' });
}

export async function getWorkflowStats(): Promise<WorkflowStats> {
  const data = await fetchJson<{ stats: WorkflowStats }>(apiUrl('/api/workflows/stats'));
  return data.stats;
}

export async function listWorkflowRuns(limit = 50): Promise<WorkflowRunSummary[]> {
  const data = await fetchJson<{ runs: WorkflowRunSummary[] }>(apiUrl(`/api/workflows/runs?limit=${limit}`));
  return data.runs ?? [];
}

export async function getWorkflowRun(runId: string): Promise<WorkflowRunView> {
  const data = await fetchJson<{ view: WorkflowRunView }>(apiUrl(`/api/workflows/runs/${encodeURIComponent(runId)}`));
  return data.view;
}

export async function startWorkflowRun(options: StartWorkflowRunOptions): Promise<{ runId: string }> {
  return fetchJson<{ runId: string }>(apiUrl('/api/workflows/runs'), {
    method: 'POST',
    body: JSON.stringify(options),
  });
}

export async function cancelWorkflowRun(runId: string): Promise<void> {
  await fetchJson(apiUrl(`/api/workflows/runs/${encodeURIComponent(runId)}/cancel`), { method: 'POST' });
}

export async function rebuildWorkflowRun(runId: string): Promise<WorkflowRunView> {
  const data = await fetchJson<{ view: WorkflowRunView }>(
    apiUrl(`/api/workflows/runs/${encodeURIComponent(runId)}/rebuild`),
    { method: 'POST' },
  );
  return data.view;
}

export async function retryWorkflowRun(runId: string): Promise<{ runId: string }> {
  return fetchJson<{ runId: string }>(
    apiUrl(`/api/workflows/runs/${encodeURIComponent(runId)}/retry`),
    { method: 'POST' },
  );
}
