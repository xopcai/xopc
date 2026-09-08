import { fetchJson } from '@/lib/fetch';
import { apiUrl } from '@/lib/url';

export type BrowserAutomationRunStatus = 'queued' | 'running' | 'succeeded' | 'failed' | 'cancelled';
export type BrowserAutomationRisk = 'read' | 'draft' | 'external_effect' | 'destructive' | 'sensitive';

export interface BrowserAutomationInput {
  type: 'string' | 'number' | 'boolean';
  required?: boolean;
  default?: string | number | boolean;
  description?: string;
  choices?: Array<string | number | boolean>;
}

export interface BrowserAutomation {
  id: string;
  name: string;
  description?: string;
  enabled: boolean;
  risk: BrowserAutomationRisk;
  domains: string[];
  inputs: Record<string, BrowserAutomationInput>;
  createdAtMs: number;
  updatedAtMs: number;
}

export interface BrowserAutomationRun {
  id: string;
  automationId: string;
  status: BrowserAutomationRunStatus;
  inputs: Record<string, unknown>;
  result?: unknown;
  error?: string;
  createdAtMs: number;
  startedAtMs?: number;
  endedAtMs?: number;
  durationMs?: number;
}

interface BrowserAutomationRecord {
  id: string;
  status: 'enabled' | 'disabled';
  definition: {
    name: string;
    description?: string;
    risk: BrowserAutomationRisk;
    allowedDomains: string[];
    inputs: Record<string, BrowserAutomationInput>;
  };
  createdAtMs: number;
  updatedAtMs: number;
}

function present(record: BrowserAutomationRecord): BrowserAutomation {
  return {
    id: record.id,
    name: record.definition.name,
    description: record.definition.description,
    enabled: record.status === 'enabled',
    risk: record.definition.risk,
    domains: record.definition.allowedDomains,
    inputs: record.definition.inputs,
    createdAtMs: record.createdAtMs,
    updatedAtMs: record.updatedAtMs,
  };
}

export const browserAutomationApi = {
  list: async () => {
    const response = await fetchJson<{ automations: BrowserAutomationRecord[] }>(apiUrl('/api/browser/automations'));
    return { automations: response.automations.map(present) };
  },
  setEnabled: async (id: string, enabled: boolean) => {
    const response = await fetchJson<{ automation: BrowserAutomationRecord }>(apiUrl(`/api/browser/automations/${encodeURIComponent(id)}`), {
    method: 'PATCH',
    body: JSON.stringify({ status: enabled ? 'enabled' : 'disabled' }),
    });
    return { automation: present(response.automation) };
  },
  remove: (id: string) => fetchJson<{ removed: boolean }>(apiUrl(`/api/browser/automations/${encodeURIComponent(id)}`), { method: 'DELETE' }),
  run: (id: string, inputs: Record<string, unknown>) => fetchJson<{ run: BrowserAutomationRun }>(apiUrl(`/api/browser/automations/${encodeURIComponent(id)}/run`), {
    method: 'POST',
    body: JSON.stringify({ inputs }),
  }),
  getRun: (id: string) => fetchJson<{ run: BrowserAutomationRun }>(apiUrl(`/api/browser/automation-runs/${encodeURIComponent(id)}`)),
  listRuns: (automationId: string) => fetchJson<{ runs: BrowserAutomationRun[] }>(apiUrl(`/api/browser/automation-runs?automationId=${encodeURIComponent(automationId)}`)),
  cancel: (runId: string) => fetchJson<{ cancelled: boolean }>(apiUrl(`/api/browser/automation-runs/${encodeURIComponent(runId)}/cancel`), { method: 'POST' }),
};
