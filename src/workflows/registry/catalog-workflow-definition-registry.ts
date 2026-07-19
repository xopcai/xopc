import { createWorkflowCatalog, type WorkflowCatalog } from '../../agent/workflow/catalog.js';
import type { WorkflowDefinition } from '../domain/definition.js';
import type { WorkflowDefinitionRegistry, WorkflowDefinitionSummary } from './workflow-definition-registry.js';

export class CatalogWorkflowDefinitionRegistry implements WorkflowDefinitionRegistry {
  constructor(private readonly catalog: WorkflowCatalog = createWorkflowCatalog()) {}

  async list(): Promise<WorkflowDefinitionSummary[]> {
    return this.catalog.list().map((entry) => ({
      id: entry.name,
      name: entry.name,
      title: entry.title ?? toTitle(entry.name),
      description: entry.description,
      source: entry.source,
      tags: entry.tags,
      whenToUse: entry.whenToUse,
    }));
  }

  async get(id: string): Promise<WorkflowDefinition | null> {
    try {
      return this.catalog.load(id);
    } catch {
      return null;
    }
  }
}

function toTitle(value: string): string {
  return value
    .split(/[_-]+/g)
    .filter(Boolean)
    .map((part) => `${part.slice(0, 1).toUpperCase()}${part.slice(1)}`)
    .join(' ');
}
