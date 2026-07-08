import type { WorkflowRunStatus } from './workflow-api';

export const WORKFLOW_RUN_LINK_CONTEXT_KIND = 'workflow-run-link';

export interface WorkflowRunLinkEntry {
  id: string;
  runId: string;
  ownerAgentId?: string;
  workflowSessionKey: string;
  definitionId: string;
  goal: string;
  status: WorkflowRunStatus;
  createdAtMs?: number;
}

function readContextRow(row: unknown): WorkflowRunLinkEntry | null {
  if (!row || typeof row !== 'object') return null;
  const record = row as Record<string, unknown>;
  if (record.kind !== 'context') return null;

  const data =
    record.data && typeof record.data === 'object' && !Array.isArray(record.data)
      ? (record.data as Record<string, unknown>)
      : null;
  if (!data || data.kind !== WORKFLOW_RUN_LINK_CONTEXT_KIND) return null;

  const runId = typeof data.runId === 'string' ? data.runId.trim() : '';
  const workflowSessionKey =
    typeof data.workflowSessionKey === 'string' ? data.workflowSessionKey.trim() : '';
  const ownerAgentId = typeof data.ownerAgentId === 'string' ? data.ownerAgentId.trim() : '';
  const definitionId = typeof data.definitionId === 'string' ? data.definitionId.trim() : '';
  if (!runId || !workflowSessionKey || !definitionId) return null;

  const goal = typeof data.goal === 'string' ? data.goal : '';
  const statusRaw = typeof data.status === 'string' ? data.status : 'running';
  const status = statusRaw as WorkflowRunStatus;
  const id =
    typeof record.id === 'string' && record.id.trim()
      ? record.id.trim()
      : `workflow-run-link:${runId}`;
  const createdAtMs =
    typeof record.createdAt === 'string' ? Date.parse(record.createdAt) : undefined;

  return {
    id,
    runId,
    ownerAgentId: ownerAgentId || undefined,
    workflowSessionKey,
    definitionId,
    goal,
    status,
    createdAtMs: Number.isFinite(createdAtMs) ? createdAtMs : undefined,
  };
}

/** Extract parent-session workflow pointer cards from on-disk transcript rows. */
export function parseWorkflowRunLinksFromTranscriptRows(rows: unknown[] | undefined): WorkflowRunLinkEntry[] {
  if (!rows?.length) return [];
  const byRunId = new Map<string, WorkflowRunLinkEntry>();
  for (const row of rows) {
    const parsed = readContextRow(row);
    if (!parsed) continue;
    const previous = byRunId.get(parsed.runId);
    byRunId.set(parsed.runId, {
      ...previous,
      ...parsed,
      ownerAgentId: parsed.ownerAgentId ?? previous?.ownerAgentId,
      workflowSessionKey: parsed.workflowSessionKey || previous?.workflowSessionKey || '',
      definitionId: parsed.definitionId || previous?.definitionId || '',
      goal: parsed.goal || previous?.goal || '',
    });
  }
  return [...byRunId.values()].toSorted(
    (a, b) => (a.createdAtMs ?? 0) - (b.createdAtMs ?? 0),
  );
}
