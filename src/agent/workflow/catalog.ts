import { existsSync, mkdirSync, readdirSync, readFileSync, renameSync, rmSync, statSync, unlinkSync, writeFileSync } from 'node:fs';
import { randomUUID } from 'node:crypto';
import { join } from 'node:path';

import type { WorkflowDefinition, WorkflowDefinitionManifest, WorkflowGraph } from '../../workflows/domain/definition.js';
import { buildWorkflowDefinition } from '../../workflows/domain/definition-utils.js';
import { validateWorkflowGraph } from '../../workflows/domain/validation.js';
import { resolveStateDir } from '../../config/paths-state.js';

import { BUILTIN_WORKFLOWS } from './builtins/index.js';

export type WorkflowSource = 'user' | 'builtin';

export interface CatalogEntry {
  name: string;
  source: WorkflowSource;
  path: string | null;
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
  save(input: SaveWorkflowInput): { path: string; definition: WorkflowDefinition };
  listRevisions(name: string): WorkflowRevisionSummary[];
  loadRevision(name: string, revision: number): WorkflowDefinition;
  restore(name: string, revision: number, expectedRevision: number): { path: string; definition: WorkflowDefinition };
  remove(name: string): boolean;
  userDir: string;
}

const NAME_RE = /^[a-z][a-z0-9_-]*$/;

export function createWorkflowCatalog(opts: { userDir?: string } = {}): WorkflowCatalog {
  const userDir = opts.userDir ?? defaultUserDir();

  const loadUser = (name: string): WorkflowDefinition | null => {
    const path = join(userDir, `${name}.json`);
    if (!existsSync(path)) return null;
    const parsed = JSON.parse(readFileSync(path, 'utf-8')) as WorkflowDefinition;
    assertStoredDefinition(parsed, name, path);
    return parsed;
  };

  const list = (): CatalogEntry[] => {
    const definitions = new Map<string, { definition: WorkflowDefinition; path: string | null }>();
    for (const definition of BUILTIN_WORKFLOWS) definitions.set(definition.name, { definition, path: null });
    for (const name of listUserNames(userDir)) {
      try {
        const definition = loadUser(name);
        if (definition) definitions.set(name, { definition, path: join(userDir, `${name}.json`) });
      } catch {
        // Invalid files are not addressable workflows.
      }
    }
    return [...definitions.values()]
      .map(({ definition, path }) => toCatalogEntry(definition, path))
      .sort((left, right) => left.name.localeCompare(right.name));
  };

  const load = (name: string): WorkflowDefinition => {
    requireValidName(name);
    const user = loadUser(name);
    if (user) return structuredClone(user);
    const builtin = BUILTIN_WORKFLOWS.find((definition) => definition.name === name);
    if (builtin) return structuredClone(builtin);
    throw new Error(`workflow not found: ${name}`);
  };

  const save = (input: SaveWorkflowInput): { path: string; definition: WorkflowDefinition } => {
    const name = input.name.trim();
    requireValidName(name);
    const validation = validateWorkflowGraph(input.graph);
    if (!validation.valid) throw new Error(validation.errors.map((issue) => issue.message).join(' '));
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
    if (!existsSync(userDir)) mkdirSync(userDir, { recursive: true });
    const path = join(userDir, `${name}.json`);
    const revisionsDir = join(userDir, '.revisions', name);
    mkdirSync(revisionsDir, { recursive: true });
    writeJsonAtomic(join(revisionsDir, `${definition.revision}.json`), definition);
    writeJsonAtomic(path, definition);
    return { path, definition };
  };

  const listRevisions = (name: string): WorkflowRevisionSummary[] => {
    requireValidName(name);
    const dir = join(userDir, '.revisions', name);
    if (!existsSync(dir)) return [];
    return readdirSync(dir)
      .filter((file) => /^\d+\.json$/.test(file))
      .map((file): WorkflowRevisionSummary | null => {
        try {
          const definition = JSON.parse(readFileSync(join(dir, file), 'utf-8')) as WorkflowDefinition;
          assertStoredDefinition(definition, name, join(dir, file));
          return { revision: definition.revision, title: definition.title, contentHash: definition.contentHash, createdAtMs: definition.metadata.updatedAtMs };
        } catch {
          return null;
        }
      })
      .filter((item): item is WorkflowRevisionSummary => item !== null)
      .sort((left, right) => right.revision - left.revision);
  };

  const loadRevision = (name: string, revision: number): WorkflowDefinition => {
    requireValidName(name);
    if (!Number.isSafeInteger(revision) || revision < 1) throw new Error('invalid workflow revision');
    const path = join(userDir, '.revisions', name, `${revision}.json`);
    if (!existsSync(path)) throw new Error(`workflow revision not found: ${name}@${revision}`);
    const definition = JSON.parse(readFileSync(path, 'utf-8')) as WorkflowDefinition;
    assertStoredDefinition(definition, name, path);
    return structuredClone(definition);
  };

  const restore = (name: string, revision: number, expectedRevision: number) => {
    const selected = loadRevision(name, revision);
    return save({ name, graph: selected.graph, manifest: definitionToManifest(selected), expectedRevision });
  };

  const remove = (name: string): boolean => {
    requireValidName(name);
    const path = join(userDir, `${name}.json`);
    if (!existsSync(path)) return false;
    unlinkSync(path);
    const revisionsDir = join(userDir, '.revisions', name);
    if (existsSync(revisionsDir)) rmSync(revisionsDir, { recursive: true, force: true });
    return true;
  };

  return { list, load, save, listRevisions, loadRevision, restore, remove, userDir };
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

export function defaultUserDir(): string {
  return join(resolveStateDir(), 'workflows');
}

function listUserNames(dir: string): string[] {
  try {
    if (!existsSync(dir) || !statSync(dir).isDirectory()) return [];
    return readdirSync(dir)
      .filter((file) => file.endsWith('.json'))
      .map((file) => file.slice(0, -5))
      .filter((name) => NAME_RE.test(name));
  } catch {
    return [];
  }
}

function assertStoredDefinition(value: WorkflowDefinition, name: string, path: string): void {
  if (!value || typeof value !== 'object' || value.name !== name || value.metadata?.source !== 'user') {
    throw new Error(`invalid workflow definition: ${path}`);
  }
  const validation = validateWorkflowGraph(value.graph);
  if (!validation.valid) throw new Error(`invalid workflow graph: ${path}`);
}

function toCatalogEntry(definition: WorkflowDefinition, path: string | null): CatalogEntry {
  return {
    name: definition.name,
    source: definition.metadata.source,
    path,
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

function writeJsonAtomic(path: string, value: unknown): void {
  const temporaryPath = `${path}.${randomUUID()}.tmp`;
  writeFileSync(temporaryPath, `${JSON.stringify(value, null, 2)}\n`, 'utf-8');
  renameSync(temporaryPath, path);
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
