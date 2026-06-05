import { fetchJson } from '@/lib/fetch';
import { apiUrl } from '@/lib/url';

export type WorkflowRunStatus = 'queued' | 'running' | 'succeeded' | 'failed' | 'cancelled' | 'timeout';
export type WorkflowPhaseStatus = 'pending' | 'running' | 'completed' | 'failed';
export type WorkflowAgentStatus = 'queued' | 'running' | 'done' | 'error' | 'skipped';

export interface WorkflowDefinition {
  id: string;
  name: string;
  title: string;
  description: string;
  version: string;
  phases: WorkflowPhaseDefinition[];
  defaults: WorkflowDefinitionDefaults;
  metadata: WorkflowDefinitionMetadata;
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
  createdAtMs: number;
  updatedAtMs: number;
}

export interface WorkflowRunMetrics {
  agentCount: number;
  doneAgentCount: number;
  errorAgentCount: number;
  skippedAgentCount: number;
  artifactCount: number;
  durationMs?: number;
}

export interface WorkflowRunSummary {
  id: string;
  definitionId: string;
  title: string;
  status: WorkflowRunStatus;
  source: unknown;
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
  source: unknown;
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

export async function listWorkflowDefinitions(): Promise<WorkflowDefinition[]> {
  const data = await fetchJson<{ definitions: WorkflowDefinition[] }>(apiUrl('/api/workflows/definitions'));
  return data.definitions ?? [];
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
