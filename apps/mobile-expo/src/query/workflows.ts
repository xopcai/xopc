import { z } from 'zod';

import { apiFetch } from '../api/client';

const WorkflowStatusSchema = z.enum(['queued', 'running', 'succeeded', 'failed', 'cancelled', 'timeout']);
const WorkflowMetricsSchema = z.object({
  agentCount: z.number(),
  doneAgentCount: z.number(),
  errorAgentCount: z.number(),
  skippedAgentCount: z.number(),
  artifactCount: z.number(),
  durationMs: z.number().optional(),
});
const WorkflowRunSummarySchema = z.object({
  id: z.string(),
  definitionId: z.string(),
  title: z.string(),
  status: WorkflowStatusSchema,
  createdAtMs: z.number(),
  startedAtMs: z.number().optional(),
  completedAtMs: z.number().optional(),
  metrics: WorkflowMetricsSchema,
});
const WorkflowRunSchema = WorkflowRunSummarySchema.extend({
  goal: z.string(),
  error: z.object({ message: z.string() }).passthrough().optional(),
});
const WorkflowRunViewSchema = z.object({
  run: WorkflowRunSchema,
  phases: z.array(z.object({
    id: z.string(),
    title: z.string(),
    status: z.enum(['pending', 'running', 'completed', 'failed']),
  })),
  agents: z.array(z.object({
    id: z.string(),
    label: z.string(),
    status: z.enum(['queued', 'running', 'done', 'error', 'skipped']),
    currentStep: z.string().optional(),
    resultPreview: z.string().optional(),
    error: z.string().optional(),
  })),
  nodes: z.array(z.object({
    id: z.string(),
    title: z.string(),
    status: z.enum(['pending', 'running', 'done', 'error', 'skipped']),
    resultPreview: z.string().optional(),
    error: z.string().optional(),
  })),
  artifacts: z.array(z.object({
    id: z.string(),
    name: z.string(),
    title: z.string().optional(),
    mimeType: z.string(),
    sizeBytes: z.number(),
  })),
  controls: z.object({
    canCancel: z.boolean(),
    canRetry: z.boolean(),
    canArchive: z.boolean(),
  }),
});

export type WorkflowRunSummary = z.infer<typeof WorkflowRunSummarySchema> & { ownerAgentId?: string };
export type WorkflowRunView = z.infer<typeof WorkflowRunViewSchema>;

async function workflowError(response: Response): Promise<Error> {
  const body = await response.json().catch(() => ({})) as { error?: string };
  return new Error(body.error || `Workflow request failed: ${response.status}`);
}

export async function fetchWorkflowRuns(agentIds: string[] = []): Promise<WorkflowRunSummary[]> {
  const owners = [...new Set(agentIds.map((id) => id.trim().toLowerCase()).filter(Boolean))];
  const pages = await Promise.all((owners.length ? owners : [undefined]).map(async (ownerAgentId) => {
    const suffix = ownerAgentId ? `&agentId=${encodeURIComponent(ownerAgentId)}` : '';
    const response = await apiFetch(`/api/workflows/runs?limit=50${suffix}`);
    if (!response.ok) throw await workflowError(response);
    const runs = z.object({ runs: z.array(WorkflowRunSummarySchema) }).parse(await response.json()).runs;
    return runs.map((run) => ({ ...run, ...(ownerAgentId ? { ownerAgentId } : {}) }));
  }));
  return [...new Map(pages.flat().map((run) => [run.id, run])).values()]
    .sort((a, b) => b.createdAtMs - a.createdAtMs);
}

export async function fetchWorkflowRun(id: string, agentId?: string): Promise<WorkflowRunView> {
  const query = agentId ? `?agentId=${encodeURIComponent(agentId)}` : '';
  const response = await apiFetch(`/api/workflows/runs/${encodeURIComponent(id)}${query}`);
  if (!response.ok) throw await workflowError(response);
  return z.object({ view: WorkflowRunViewSchema }).parse(await response.json()).view;
}

export async function cancelWorkflowRun(id: string, agentId?: string): Promise<void> {
  const query = agentId ? `?agentId=${encodeURIComponent(agentId)}` : '';
  const response = await apiFetch(`/api/workflows/runs/${encodeURIComponent(id)}/cancel${query}`, {
    method: 'POST',
  });
  if (!response.ok) throw await workflowError(response);
}
