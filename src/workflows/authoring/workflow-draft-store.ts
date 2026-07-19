import { randomUUID } from 'node:crypto';
import { existsSync, mkdirSync, readdirSync, readFileSync, renameSync, unlinkSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

import { defaultUserDir } from '../../agent/workflow/catalog.js';
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
  private readonly draftsDir: string;

  constructor(options: { userDir?: string } = {}) {
    this.draftsDir = join(options.userDir ?? defaultUserDir(), '.drafts');
  }

  list(workflowName?: string): WorkflowAuthoringDraft[] {
    if (!existsSync(this.draftsDir)) return [];
    return readdirSync(this.draftsDir)
      .filter((file) => file.endsWith('.json'))
      .map((file) => this.readFile(join(this.draftsDir, file)))
      .filter((draft): draft is WorkflowAuthoringDraft => Boolean(draft) && (!workflowName || draft.workflowName === workflowName))
      .sort((left, right) => right.updatedAtMs - left.updatedAtMs);
  }

  get(id: string): WorkflowAuthoringDraft | null {
    requireDraftId(id);
    return this.readFile(join(this.draftsDir, `${id}.json`));
  }

  save(input: SaveWorkflowAuthoringDraftInput): WorkflowAuthoringDraft {
    if (!input.graph || input.graph.schemaVersion !== 1 || !Array.isArray(input.graph.nodes) || !Array.isArray(input.graph.edges)) {
      throw new Error('workflow draft graph is invalid');
    }
    const id = input.id ?? randomUUID();
    requireDraftId(id);
    const existing = this.get(id);
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
    mkdirSync(this.draftsDir, { recursive: true });
    writeJsonAtomic(join(this.draftsDir, `${id}.json`), draft);
    return draft;
  }

  remove(id: string): boolean {
    requireDraftId(id);
    const path = join(this.draftsDir, `${id}.json`);
    if (!existsSync(path)) return false;
    unlinkSync(path);
    return true;
  }

  private readFile(path: string): WorkflowAuthoringDraft | null {
    try {
      const value = JSON.parse(readFileSync(path, 'utf-8')) as WorkflowAuthoringDraft;
      return value && typeof value.id === 'string' && value.graph?.schemaVersion === 1 ? value : null;
    } catch {
      return null;
    }
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

function writeJsonAtomic(path: string, value: unknown): void {
  const temporaryPath = `${path}.${randomUUID()}.tmp`;
  writeFileSync(temporaryPath, `${JSON.stringify(value, null, 2)}\n`, 'utf-8');
  renameSync(temporaryPath, path);
}
