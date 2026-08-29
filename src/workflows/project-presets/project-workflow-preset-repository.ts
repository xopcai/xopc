import type { WorkflowRunContextRef } from '../domain/index.js';
import { getSqliteDatabase } from '../../storage/sqlite/transaction.js';

type ProjectWorkflowPresetRow = {
  project_id: string;
  definition_id: string;
  context_refs_json: string;
  created_at: number;
  updated_at: number;
};

export interface ProjectWorkflowPreset {
  projectId: string;
  definitionId: string;
  contextRefs: WorkflowRunContextRef[];
  createdAt: number;
  updatedAt: number;
}

function fromRow(row: ProjectWorkflowPresetRow): ProjectWorkflowPreset {
  return {
    projectId: row.project_id,
    definitionId: row.definition_id,
    contextRefs: JSON.parse(row.context_refs_json) as WorkflowRunContextRef[],
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

export class ProjectWorkflowPresetRepository {
  list(projectId: string): ProjectWorkflowPreset[] {
    return (getSqliteDatabase().prepare(
      'SELECT * FROM project_workflow_presets WHERE project_id = ? ORDER BY updated_at DESC',
    ).all(projectId) as ProjectWorkflowPresetRow[]).map(fromRow);
  }

  get(projectId: string, definitionId: string): ProjectWorkflowPreset | undefined {
    const row = getSqliteDatabase().prepare(
      'SELECT * FROM project_workflow_presets WHERE project_id = ? AND definition_id = ?',
    ).get(projectId, definitionId) as ProjectWorkflowPresetRow | undefined;
    return row ? fromRow(row) : undefined;
  }

  save(input: {
    projectId: string;
    definitionId: string;
    contextRefs: WorkflowRunContextRef[];
    now?: number;
  }): ProjectWorkflowPreset {
    const now = input.now ?? Date.now();
    getSqliteDatabase().prepare(
      `INSERT INTO project_workflow_presets (
        project_id, definition_id, context_refs_json, created_at, updated_at
      ) VALUES (?, ?, ?, ?, ?)
      ON CONFLICT(project_id, definition_id) DO UPDATE SET
        context_refs_json = excluded.context_refs_json,
        updated_at = excluded.updated_at`,
    ).run(input.projectId, input.definitionId, JSON.stringify(input.contextRefs), now, now);
    return this.get(input.projectId, input.definitionId)!;
  }

  remove(projectId: string, definitionId: string): boolean {
    return getSqliteDatabase().prepare(
      'DELETE FROM project_workflow_presets WHERE project_id = ? AND definition_id = ?',
    ).run(projectId, definitionId).changes > 0;
  }

  removeDefinition(definitionId: string): number {
    return Number(getSqliteDatabase().prepare(
      'DELETE FROM project_workflow_presets WHERE definition_id = ?',
    ).run(definitionId).changes);
  }
}
