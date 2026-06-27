import type { Message } from '@/features/chat/messages/messages.types';
import { sessionWireToUiMessages } from '@/features/chat/messages/agent-messages';
import { apiFetch, fetchJson } from '@/lib/fetch';
import { formatApiHttpError } from '@/lib/http-error-message';
import { apiUrl } from '@/lib/url';

export type WorkflowRunStatus = 'queued' | 'running' | 'succeeded' | 'failed' | 'cancelled' | 'timeout';
export type WorkflowPhaseStatus = 'pending' | 'running' | 'completed' | 'failed';
export type WorkflowAgentStatus = 'queued' | 'running' | 'done' | 'error' | 'skipped';

export interface JsonSchema {
  type?: string | string[];
  title?: string;
  description?: string;
  properties?: Record<string, JsonSchema>;
  items?: JsonSchema | JsonSchema[];
  required?: string[];
  additionalProperties?: boolean | JsonSchema;
  enum?: unknown[];
  const?: unknown;
  default?: unknown;
  [key: string]: unknown;
}

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
  contentHash?: string;
  runtimeHash?: string;
  inputSchema?: JsonSchema;
  outputSchema?: JsonSchema;
  phases: WorkflowPhaseDefinition[];
  runtime?: WorkflowRuntimeDefinition;
  defaults: WorkflowDefinitionDefaults;
  permissions?: WorkflowPermissionPolicy;
  resources?: WorkflowResourceRefs;
  metadata: WorkflowDefinitionMetadata;
}

export interface WorkflowPermissionPolicy {
  tools?: string[];
  network?: boolean;
  fileSystem?: 'read' | 'write' | 'none';
  approvalRequired?: boolean;
}

export interface WorkflowResourceRefs {
  skills?: string[];
  contextFiles?: string[];
  promptTemplates?: string[];
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
  goalId?: string;
  retryOfRunId?: string;
  replay?: WorkflowRunReplayMetadata;
  definition: WorkflowRunDefinitionSnapshot;
  input?: WorkflowRunInputEnvelope;
  correlation?: WorkflowRunCorrelation;
  origin?: WorkflowRunOrigin;
  schedule?: WorkflowRunScheduleMetadata;
}

export type WorkflowRunReplayScope = 'failed_agents' | 'failed_phases';

export interface WorkflowRunReplayMetadata {
  sourceRunId: string;
  scope: WorkflowRunReplayScope;
  phaseIds?: string[];
  agentIds: string[];
  targetCount: number;
  createdAtMs: number;
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
  contentHash?: string;
  runtimeHash?: string;
  source: 'builtin' | 'user';
  tags: string[];
  phaseCount: number;
  defaults?: WorkflowDefinitionDefaults;
  permissions?: WorkflowPermissionPolicy;
  resources?: WorkflowResourceRefs;
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

export interface WorkflowArtifactRef {
  id: string;
  runId: string;
  name: string;
  title?: string;
  mimeType: string;
  sizeBytes: number;
  createdAtMs: number;
}

export interface WorkflowFollowUp {
  id: string;
  title: string;
  prompt?: string;
  priority?: 'low' | 'medium' | 'high';
}

export interface WorkflowResultEnvelope {
  title?: string;
  summary: string;
  sections: WorkflowResultSection[];
  actions?: unknown[];
  artifacts?: WorkflowArtifactRef[];
  followUps?: WorkflowFollowUp[];
  structuredOutput?: unknown;
}

export type WorkflowResultSection =
  | { kind: 'text'; title: string; content: string }
  | {
      kind: 'findings';
      title: string;
      items: Array<{ title: string; severity?: string; file?: string; line?: number; detail?: string; recommendation?: string }>;
    }
  | {
      kind: 'risks';
      title: string;
      items: Array<{ title: string; severity?: string; likelihood?: 'low' | 'medium' | 'high'; impact?: string; mitigation?: string }>;
    }
  | { kind: 'questions'; title: string; items: string[] }
  | { kind: 'json'; title: string; value: unknown };

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
  result?: WorkflowResultEnvelope;
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
  invocation?: WorkflowAgentInvocationSnapshot;
  sessionKey: string;
  transcriptMessageCount: number;
  currentStep?: string;
  resultPreview?: string;
  error?: string;
  startedAtMs?: number;
  completedAtMs?: number;
  steps?: Array<{
    id: string;
    label: string;
    kind: 'tool' | 'llm' | 'thinking';
    toolName?: string;
    detail?: string;
    status: 'running' | 'done' | 'error';
    resultPreview?: string;
    error?: string;
    startedAtMs?: number;
    completedAtMs?: number;
  }>;
}

export interface WorkflowAgentInvocationSnapshot {
  prompt: string;
  label: string;
  phase?: string;
  modelRef?: string;
  resolvedModelRef?: string;
  schema?: unknown;
  toolset?: string[];
  maxIterations?: number;
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

export interface WorkflowRunComparison {
  sourceRunId: string;
  replayRunId: string;
  sourceStatus: WorkflowRunStatus;
  replayStatus: WorkflowRunStatus;
  statusChanged: boolean;
  durationDeltaMs: number | null;
  failedAgentsBefore: number;
  failedAgentsAfter: number;
  fixedAgentIds: string[];
  stillFailingAgentIds: string[];
  targetAgents: Array<{
    agentId: string;
    label: string;
    beforeStatus?: WorkflowAgentStatus;
    afterStatus?: WorkflowAgentStatus;
    beforeError?: string;
    afterError?: string;
    beforePreview?: string;
    afterPreview?: string;
  }>;
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
  goalId?: string;
  goal?: string;
  input?: unknown;
  agentId?: string;
  parentSessionKey?: string;
  concurrency?: number;
  maxSubagents?: number;
  tokenBudget?: number | null;
}

export interface StartWorkflowRunResult {
  runId: string;
  sessionKey: string;
}

export interface WorkflowAgentSession {
  sessionKey: string;
  metadata: {
    sessionType: 'workflow-subagent';
    workflowRunId?: string;
    workflowAgentId?: string;
    workflowAgentLabel?: string;
  };
  messages: Message[];
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

export interface WorkflowDraftConstraints {
  allowedTools?: string[];
  allowNetwork?: boolean;
  fileSystem?: 'none' | 'read' | 'write';
  maxPhases?: number;
  maxSubagents?: number;
  outputFormat?: 'report' | 'json' | 'actions';
}

export interface WorkflowDraftLintIssue {
  severity: 'error' | 'warning';
  code: string;
  message: string;
}

export interface WorkflowDraftResponse {
  draftId: string;
  repairAttempts: number;
  name: string;
  script: string;
  manifest: WorkflowDefinitionManifest;
  explanation: string;
  assumptions: string[];
  risks: string[];
  permissionsSummary: string[];
  validation: ValidateWorkflowDefinitionResponse;
  lint: WorkflowDraftLintIssue[];
  suggestedInputs?: Array<{ key: string; label: string; example: string }>;
}

export interface WorkflowDefinitionManifest {
  title?: string;
  description?: string;
  version?: string;
  inputSchema?: JsonSchema;
  outputSchema?: JsonSchema;
  defaults?: Partial<WorkflowDefinitionDefaults>;
  tags?: string[];
  whenToUse?: string;
  permissions?: WorkflowPermissionPolicy;
  resources?: WorkflowResourceRefs;
}

export interface CreateWorkflowDraftOptions {
  prompt: string;
  agentId?: string;
  language?: 'en' | 'zh';
  mode?: 'create' | 'improve';
  existingScript?: string;
  constraints?: WorkflowDraftConstraints;
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

export async function createWorkflowDraft(options: CreateWorkflowDraftOptions): Promise<WorkflowDraftResponse> {
  const data = await fetchJson<{ draft: WorkflowDraftResponse }>(apiUrl('/api/workflows/definitions/draft'), {
    method: 'POST',
    body: JSON.stringify(options),
  });
  return data.draft;
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

export interface WorkflowOwnerAgentOptions {
  ownerAgentId?: string;
  goalId?: string;
}

function appendOwnerAgentParam(params: URLSearchParams, options?: WorkflowOwnerAgentOptions): void {
  const ownerAgentId = options?.ownerAgentId?.trim();
  if (ownerAgentId) params.set('agentId', ownerAgentId);
}

export async function getWorkflowStats(definitionId?: string, options?: WorkflowOwnerAgentOptions): Promise<WorkflowStats> {
  const trimmedDefinitionId = definitionId?.trim();
  const searchParams = new URLSearchParams();
  if (trimmedDefinitionId) searchParams.set('definitionId', trimmedDefinitionId);
  appendOwnerAgentParam(searchParams, options);
  const suffix = searchParams.size > 0 ? `?${searchParams.toString()}` : '';
  const data = await fetchJson<{ stats: WorkflowStats }>(apiUrl(`/api/workflows/stats${suffix}`));
  return data.stats;
}

export async function listWorkflowRuns(limit = 50, options?: WorkflowOwnerAgentOptions): Promise<WorkflowRunSummary[]> {
  const searchParams = new URLSearchParams({ limit: String(limit) });
  appendOwnerAgentParam(searchParams, options);
  const goalId = options?.goalId?.trim();
  if (goalId) searchParams.set('goalId', goalId);
  const data = await fetchJson<{ runs: WorkflowRunSummary[] }>(apiUrl(`/api/workflows/runs?${searchParams.toString()}`));
  return data.runs ?? [];
}

export async function getWorkflowRun(runId: string, options?: WorkflowOwnerAgentOptions): Promise<WorkflowRunView> {
  const searchParams = new URLSearchParams();
  appendOwnerAgentParam(searchParams, options);
  const suffix = searchParams.size > 0 ? `?${searchParams.toString()}` : '';
  const data = await fetchJson<{ view: WorkflowRunView }>(apiUrl(`/api/workflows/runs/${encodeURIComponent(runId)}${suffix}`));
  return data.view;
}

export async function getWorkflowRunComparison(
  runId: string,
  options?: WorkflowOwnerAgentOptions,
): Promise<WorkflowRunComparison> {
  const searchParams = new URLSearchParams();
  appendOwnerAgentParam(searchParams, options);
  const suffix = searchParams.size > 0 ? `?${searchParams.toString()}` : '';
  const data = await fetchJson<{ comparison: WorkflowRunComparison }>(
    apiUrl(`/api/workflows/runs/${encodeURIComponent(runId)}/comparison${suffix}`),
  );
  return data.comparison;
}

export async function downloadWorkflowArtifact(
  runId: string,
  artifactId: string,
  options?: WorkflowOwnerAgentOptions,
): Promise<Blob> {
  const searchParams = new URLSearchParams();
  appendOwnerAgentParam(searchParams, options);
  const suffix = searchParams.size > 0 ? `?${searchParams.toString()}` : '';
  const res = await apiFetch(
    apiUrl(
      `/api/workflows/runs/${encodeURIComponent(runId)}/artifacts/${encodeURIComponent(artifactId)}${suffix}`,
    ),
    { headers: { Accept: '*/*' } },
  );
  if (!res.ok) {
    const body = await res.json().catch(() => ({})) as { error?: string | { message?: string } };
    const serverMessage = typeof body.error === 'string' ? body.error : body.error?.message;
    throw new Error(formatApiHttpError(res.status, res.statusText, serverMessage));
  }
  return res.blob();
}

export async function getWorkflowAgentSession(
  runId: string,
  workflowAgentId: string | number,
  options?: { ownerAgentId?: string },
): Promise<WorkflowAgentSession> {
  const params = new URLSearchParams();
  const ownerAgentId = options?.ownerAgentId?.trim();
  if (ownerAgentId) params.set('ownerAgentId', ownerAgentId);
  const suffix = params.size > 0 ? `?${params.toString()}` : '';
  const data = await fetchJson<Omit<WorkflowAgentSession, 'messages'> & { messages?: unknown[] }>(
    apiUrl(
      `/api/workflows/runs/${encodeURIComponent(runId)}/agents/${encodeURIComponent(String(workflowAgentId))}/session${suffix}`,
    ),
  );
  return {
    ...data,
    messages: sessionWireToUiMessages(data.messages ?? []),
  };
}

export async function startWorkflowRun(options: StartWorkflowRunOptions): Promise<StartWorkflowRunResult> {
  return fetchJson<StartWorkflowRunResult>(apiUrl('/api/workflows/runs'), {
    method: 'POST',
    body: JSON.stringify(options),
  });
}

export async function listGoalWorkflowRuns(goalId: string, limit = 50): Promise<WorkflowRunSummary[]> {
  const searchParams = new URLSearchParams({ limit: String(limit) });
  const data = await fetchJson<{ ok: true; runs: WorkflowRunSummary[] }>(
    apiUrl(`/api/goals/${encodeURIComponent(goalId)}/workflow-runs?${searchParams.toString()}`),
  );
  return data.runs ?? [];
}

export async function startGoalWorkflowRun(options: {
  goalId: string;
  definitionId: string;
  goal?: string;
  input?: unknown;
  concurrency?: number;
  maxSubagents?: number;
}): Promise<StartWorkflowRunResult> {
  const data = await fetchJson<{ ok: true; runId: string; sessionKey: string }>(
    apiUrl(`/api/goals/${encodeURIComponent(options.goalId)}/workflows/run`),
    {
      method: 'POST',
      body: JSON.stringify({
        definitionId: options.definitionId,
        goal: options.goal,
        input: options.input,
        concurrency: options.concurrency,
        maxSubagents: options.maxSubagents,
      }),
    },
  );
  return { runId: data.runId, sessionKey: data.sessionKey };
}

export async function cancelWorkflowRun(runId: string, options?: WorkflowOwnerAgentOptions): Promise<void> {
  const searchParams = new URLSearchParams();
  appendOwnerAgentParam(searchParams, options);
  const suffix = searchParams.size > 0 ? `?${searchParams.toString()}` : '';
  await fetchJson(apiUrl(`/api/workflows/runs/${encodeURIComponent(runId)}/cancel${suffix}`), { method: 'POST' });
}

export async function rebuildWorkflowRun(runId: string, options?: WorkflowOwnerAgentOptions): Promise<WorkflowRunView> {
  const searchParams = new URLSearchParams();
  appendOwnerAgentParam(searchParams, options);
  const suffix = searchParams.size > 0 ? `?${searchParams.toString()}` : '';
  const data = await fetchJson<{ view: WorkflowRunView }>(
    apiUrl(`/api/workflows/runs/${encodeURIComponent(runId)}/rebuild${suffix}`),
    { method: 'POST' },
  );
  return data.view;
}

export async function retryWorkflowRun(runId: string, options?: WorkflowOwnerAgentOptions): Promise<StartWorkflowRunResult> {
  const searchParams = new URLSearchParams();
  appendOwnerAgentParam(searchParams, options);
  const suffix = searchParams.size > 0 ? `?${searchParams.toString()}` : '';
  return fetchJson<StartWorkflowRunResult>(
    apiUrl(`/api/workflows/runs/${encodeURIComponent(runId)}/retry${suffix}`),
    { method: 'POST' },
  );
}

export async function replayWorkflowRun(
  runId: string,
  scope: WorkflowRunReplayScope,
  options?: WorkflowOwnerAgentOptions,
): Promise<StartWorkflowRunResult> {
  const searchParams = new URLSearchParams();
  appendOwnerAgentParam(searchParams, options);
  const suffix = searchParams.size > 0 ? `?${searchParams.toString()}` : '';
  return fetchJson<StartWorkflowRunResult>(
    apiUrl(`/api/workflows/runs/${encodeURIComponent(runId)}/replay${suffix}`),
    {
      method: 'POST',
      body: JSON.stringify({ scope }),
    },
  );
}
