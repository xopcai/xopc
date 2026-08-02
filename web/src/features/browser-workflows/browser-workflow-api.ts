import { fetchJson } from '@/lib/fetch';
import { apiUrl } from '@/lib/url';

export type BrowserWorkflowRunStatus = 'queued' | 'running' | 'succeeded' | 'failed' | 'cancelled';
export type BrowserWorkflowRisk = 'read_only' | 'account_write' | 'sensitive';

export interface BrowserWorkflowInput {
  type: 'string' | 'number' | 'integer' | 'boolean';
  required?: boolean;
  default?: string | number | boolean;
  description?: string;
  choices?: Array<string | number | boolean>;
}

export interface BrowserWorkflow {
  id: string;
  name: string;
  description?: string;
  enabled: boolean;
  risk: BrowserWorkflowRisk;
  domains: string[];
  inputs: Record<string, BrowserWorkflowInput>;
  createdAtMs: number;
  updatedAtMs: number;
}

export interface BrowserWorkflowRun {
  id: string;
  workflowId: string;
  status: BrowserWorkflowRunStatus;
  inputs: Record<string, unknown>;
  result?: unknown;
  error?: string;
  createdAtMs: number;
  startedAtMs?: number;
  endedAtMs?: number;
  durationMs?: number;
}

export const browserWorkflowApi = {
  list: () => fetchJson<{ workflows: BrowserWorkflow[] }>(apiUrl('/api/browser/workflows')),
  setEnabled: (id: string, enabled: boolean) => fetchJson<{ workflow: BrowserWorkflow }>(apiUrl(`/api/browser/workflows/${encodeURIComponent(id)}`), {
    method: 'PATCH',
    body: JSON.stringify({ enabled }),
  }),
  remove: (id: string) => fetchJson<{ removed: boolean }>(apiUrl(`/api/browser/workflows/${encodeURIComponent(id)}`), { method: 'DELETE' }),
  run: (id: string, inputs: Record<string, unknown>) => fetchJson<{ run: BrowserWorkflowRun }>(apiUrl(`/api/browser/workflows/${encodeURIComponent(id)}/run`), {
    method: 'POST',
    body: JSON.stringify({ inputs }),
  }),
  getRun: (id: string) => fetchJson<{ run: BrowserWorkflowRun }>(apiUrl(`/api/browser/workflow-runs/${encodeURIComponent(id)}`)),
  listRuns: (workflowId: string) => fetchJson<{ runs: BrowserWorkflowRun[] }>(apiUrl(`/api/browser/workflow-runs?workflowId=${encodeURIComponent(workflowId)}`)),
  cancel: (runId: string) => fetchJson<{ cancelled: boolean }>(apiUrl(`/api/browser/workflow-runs/${encodeURIComponent(runId)}/cancel`), { method: 'POST' }),
};
