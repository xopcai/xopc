import { randomUUID } from 'node:crypto';
import { DurableState } from '../../storage/sqlite/durable-state.js';
import type { WorkflowDefinitionManifest, WorkflowGraph } from '../domain/definition.js';

export interface WorkflowAuthoringDraft {
  id: string;
  workflowName: string;
  graph: WorkflowGraph;
  manifest: WorkflowDefinitionManifest;
  baseRevision: number;
  createdAtMs: number;
  updatedAtMs: number;
}

export interface SaveWorkflowAuthoringDraftInput {
  id?: string;
  workflowName: string;
  graph: WorkflowGraph;
  manifest?: WorkflowDefinitionManifest;
  baseRevision?: number;
  expectedUpdatedAtMs?: number;
}

export class WorkflowDraftStore {
  private readonly state = new DurableState<WorkflowAuthoringDraft>('workflow-drafts');

  list(workflowName?: string): WorkflowAuthoringDraft[] {
    return this.state.values().filter(draft => !workflowName || draft.workflowName === workflowName)
      .sort((a, b) => b.updatedAtMs - a.updatedAtMs);
  }

  get(id: string): WorkflowAuthoringDraft | null {
    requireDraftId(id);
    return this.state.get(id) ?? null;
  }

  save(input: SaveWorkflowAuthoringDraftInput): WorkflowAuthoringDraft {
    if (!input.graph || input.graph.schemaVersion !== 1 || !Array.isArray(input.graph.nodes) || !Array.isArray(input.graph.edges)) {
      throw new Error('workflow draft graph is invalid');
    }
    const id = input.id ?? randomUUID();
    requireDraftId(id);
    return this.state.update(id, existing => {
      if (input.expectedUpdatedAtMs !== undefined && input.expectedUpdatedAtMs !== existing?.updatedAtMs) {
        throw new WorkflowDraftConflictError(existing?.updatedAtMs);
      }
      const now = Math.max(Date.now(), (existing?.updatedAtMs ?? 0) + 1);
      const draft: WorkflowAuthoringDraft = {
        id,
        workflowName: input.workflowName.trim(),
        graph: structuredClone(input.graph),
        manifest: structuredClone(input.manifest ?? {}),
        baseRevision: input.baseRevision ?? existing?.baseRevision ?? 0,
        createdAtMs: existing?.createdAtMs ?? now,
        updatedAtMs: now,
      };
      if (!draft.workflowName) throw new Error('workflowName is required');
      return { value: draft, result: draft };
    });
  }

  remove(id: string): boolean {
    requireDraftId(id);
    return this.state.delete(id);
  }
}

export class WorkflowDraftConflictError extends Error {
  constructor(readonly currentUpdatedAtMs?: number) {
    super('workflow draft was changed by another editor');
    this.name = 'WorkflowDraftConflictError';
  }
}

function requireDraftId(id: string): void {
  if (!/^[a-zA-Z0-9_-]+$/.test(id)) throw new Error('invalid workflow draft id');
}
