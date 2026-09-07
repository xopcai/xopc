import { DurableState } from '../../storage/sqlite/durable-state.js';
import { requireXopcDatabase } from '../../storage/sqlite/connection.js';
import { runSqliteWriteTransaction } from '../../storage/sqlite/transaction.js';

import type { WorkflowDefinition, WorkflowDefinitionManifest, WorkflowGraph } from '../../workflows/domain/definition.js';
import { buildWorkflowDefinition } from '../../workflows/domain/definition-utils.js';
import { validateWorkflowGraph } from '../../workflows/domain/validation.js';

import { BUILTIN_WORKFLOWS } from './builtins/index.js';

export type WorkflowSource = 'user' | 'builtin';

export interface CatalogEntry {
  name: string;
  source: WorkflowSource;
  description: string;
  title: string;
  version: string;
  revision: number;
  whenToUse?: string;
  tags?: string[];
  estimatedAgents?: { min: number; max: number };
}

export interface SaveWorkflowInput {
  name: string;
  graph: WorkflowGraph;
  manifest?: WorkflowDefinitionManifest;
  expectedRevision?: number;
  intent?: 'create' | 'update';
}

export interface WorkflowRevisionSummary {
  revision: number;
  title: string;
  contentHash?: string;
  createdAtMs: number;
}

export interface WorkflowCatalog {
  list(): CatalogEntry[];
  load(name: string): WorkflowDefinition;
  save(input: SaveWorkflowInput): { definition: WorkflowDefinition };
  listRevisions(name: string): WorkflowRevisionSummary[];
  loadRevision(name: string, revision: number): WorkflowDefinition;
  restore(name: string, revision: number, expectedRevision: number): { definition: WorkflowDefinition };
  remove(name: string): boolean;
}

const NAME_RE = /^[a-z][a-z0-9_-]*$/;

export function createWorkflowCatalog(): WorkflowCatalog {
  const definitions = new DurableState<WorkflowDefinition>('workflow-definitions');
  const revisions = (name: string) => new DurableState<WorkflowDefinition>('workflow-revisions', name);
  const loadUser = (name: string): WorkflowDefinition | null => definitions.get(name) ?? null;

  const list = (): CatalogEntry[] => {
    const items = new Map(BUILTIN_WORKFLOWS.map(definition => [definition.name, definition]));
    for (const definition of definitions.values()) items.set(definition.name, definition);
    return [...items.values()].map(toCatalogEntry).sort((a, b) => a.name.localeCompare(b.name));
  };

  const load = (name: string): WorkflowDefinition => {
    requireValidName(name);
    const user = loadUser(name);
    if (user) return structuredClone(user);
    const builtin = BUILTIN_WORKFLOWS.find((definition) => definition.name === name);
    if (builtin) return structuredClone(builtin);
    throw new Error(`workflow not found: ${name}`);
  };

  const save = (input: SaveWorkflowInput): { definition: WorkflowDefinition } => {
    const name = input.name.trim();
    requireValidName(name);
    const validation = validateWorkflowGraph(input.graph);
    if (!validation.valid) throw new Error(validation.errors.map((issue) => issue.message).join(' '));
    requireXopcDatabase();
    return runSqliteWriteTransaction(() => {
      const existing = loadUser(name);
      const builtin = BUILTIN_WORKFLOWS.find((definition) => definition.name === name);
      if (input.intent === 'create' && (existing || builtin)) {
        throw new WorkflowNameConflictError(name, existing?.revision ?? builtin?.revision ?? 0);
      }
      if (input.expectedRevision !== undefined && input.expectedRevision !== (existing?.revision ?? 0)) {
        throw new WorkflowRevisionConflictError(existing?.revision ?? 0);
      }
      const definition = buildWorkflowDefinition({
        name,
        source: 'user',
        graph: input.graph,
        manifest: input.manifest,
        revision: (existing?.revision ?? 0) + 1,
        createdAtMs: existing?.metadata.createdAtMs,
    });
    revisions(name).set(String(definition.revision), definition);
    definitions.set(name, definition);
    return { definition };
    });
  };

  const listRevisions = (name: string): WorkflowRevisionSummary[] => {
    requireValidName(name);
    return revisions(name).values().map(definition => ({
      revision: definition.revision, title: definition.title,
      contentHash: definition.contentHash, createdAtMs: definition.metadata.updatedAtMs,
    })).sort((a, b) => b.revision - a.revision);
  };

  const loadRevision = (name: string, revision: number): WorkflowDefinition => {
    requireValidName(name);
    if (!Number.isSafeInteger(revision) || revision < 1) throw new Error('invalid workflow revision');
    const definition = revisions(name).get(String(revision));
    if (!definition) throw new Error(`workflow revision not found: ${name}@${revision}`);
    return definition;
  };

  const restore = (name: string, revision: number, expectedRevision: number) => {
    const selected = loadRevision(name, revision);
    return save({ name, graph: selected.graph, manifest: definitionToManifest(selected), expectedRevision });
  };

  const remove = (name: string): boolean => {
    requireValidName(name);
    requireXopcDatabase();
    return runSqliteWriteTransaction(() => {
      const deleted = definitions.delete(name);
      for (const [key] of revisions(name).entries()) revisions(name).delete(key);
      return deleted;
    });
  };

  return { list, load, save, listRevisions, loadRevision, restore, remove };
}

export class WorkflowRevisionConflictError extends Error {
  constructor(readonly currentRevision: number) {
    super(`workflow revision conflict; current revision is ${currentRevision}`);
    this.name = 'WorkflowRevisionConflictError';
  }
}

export class WorkflowNameConflictError extends Error {
  constructor(readonly workflowName: string, readonly currentRevision: number) {
    super(`workflow name already exists: ${workflowName}`);
    this.name = 'WorkflowNameConflictError';
  }
}

function toCatalogEntry(definition: WorkflowDefinition): CatalogEntry {
  return {
    name: definition.name,
    source: definition.metadata.source,
    description: definition.description,
    title: definition.title,
    version: definition.version,
    revision: definition.revision,
    whenToUse: definition.metadata.whenToUse,
    tags: definition.metadata.tags,
    estimatedAgents: definition.metadata.estimatedAgents,
  };
}

function requireValidName(name: string): void {
  if (!NAME_RE.test(name)) throw new Error(`invalid workflow name "${name}"; use lowercase letters, numbers, underscores, or hyphens`);
}

function definitionToManifest(definition: WorkflowDefinition): WorkflowDefinitionManifest {
  return {
    title: definition.title,
    description: definition.description,
    version: definition.version,
    inputSchema: definition.inputSchema,
    outputSchema: definition.outputSchema,
    defaults: definition.defaults,
    tags: definition.metadata.tags,
    whenToUse: definition.metadata.whenToUse,
    estimatedAgents: definition.metadata.estimatedAgents,
    examplePrompts: definition.metadata.examplePrompts,
    i18n: definition.metadata.i18n,
    permissions: definition.permissions,
    resources: definition.resources,
    connectors: definition.connectors,
  };
}
