import { Type } from '@sinclair/typebox';
import type { AgentTool, AgentToolResult } from '@earendil-works/pi-agent-core';
import {
  appendProductDeliveryText,
  PRODUCT_DELIVERY_VERSION,
  type ProductDeliveryEnvelope,
} from '@xopcai/gateway-contract';

import { createWorkflowCatalog, WorkflowNameConflictError, WorkflowRevisionConflictError } from '../workflow/catalog.js';
import { validateWorkflowDefinitionInput } from '../../workflows/domain/index.js';
import type { WorkflowDefinitionManifest, WorkflowGraph } from '../../workflows/domain/index.js';
import {
  createStarterWorkflowGraph,
  createStarterWorkflowManifest,
  WorkflowDraftConflictError,
  WorkflowDraftStore,
} from '../../workflows/authoring/index.js';

const WorkflowManageSchema = Type.Object({
  action: Type.Union([
    Type.Literal('list'),
    Type.Literal('open_draft'),
    Type.Literal('get_draft'),
    Type.Literal('replace_draft'),
    Type.Literal('validate_draft'),
    Type.Literal('publish_draft'),
  ]),
  workflowName: Type.Optional(Type.String({ description: 'Saved or new lowercase snake_case workflow name.' })),
  draftId: Type.Optional(Type.String({ description: 'Draft id returned by open_draft.' })),
  graph: Type.Optional(Type.Any({ description: 'Complete workflow graph for replace_draft.' })),
  manifest: Type.Optional(Type.Any({ description: 'Complete workflow manifest for replace_draft.' })),
  expectedUpdatedAtMs: Type.Optional(Type.Number({ description: 'Latest draft updatedAtMs; required for replace_draft and publish_draft.' })),
  confirmed: Type.Optional(Type.Boolean({ description: 'Must be true for publish_draft after the user explicitly confirms this draft.' })),
});

type WorkflowManageInput = {
  action: 'list' | 'open_draft' | 'get_draft' | 'replace_draft' | 'validate_draft' | 'publish_draft';
  workflowName?: string;
  draftId?: string;
  graph?: WorkflowGraph;
  manifest?: WorkflowDefinitionManifest;
  expectedUpdatedAtMs?: number;
  confirmed?: boolean;
};

export function createWorkflowManageTool(): AgentTool {
  const store = new WorkflowDraftStore();
  return {
    name: 'workflow_manage',
    label: '◆ Workflow builder',
    description: 'Create and edit saved workflows through durable validated drafts. Use list/open/get/replace/validate, then publish only after user confirmation.',
    parameters: WorkflowManageSchema,
    async execute(_toolCallId: string, input: WorkflowManageInput): Promise<AgentToolResult<any>> {
      try {
        if (input.action === 'list') return listWorkflows();
        if (input.action === 'open_draft') return openDraft(store, input.workflowName);
        const draft = requireDraft(store, input.draftId);
        if (input.action === 'get_draft') return success(JSON.stringify(draft, null, 2), { draft });
        if (input.action === 'validate_draft') return validateDraft(draft);
        if (input.action === 'replace_draft') return replaceDraft(store, draft, input);
        return publishDraft(store, draft, input.expectedUpdatedAtMs, input.confirmed);
      } catch (error) {
        return failure(error instanceof Error ? error.message : String(error));
      }
    },
  } as AgentTool;
}

function listWorkflows(): AgentToolResult<any> {
  const catalog = createWorkflowCatalog();
  const workflows = catalog.list().slice(0, 100).map((entry) => ({ name: entry.name, title: entry.title, description: entry.description, revision: entry.revision }));
  return success(workflows.length ? JSON.stringify(workflows, null, 2) : 'No saved workflows.', { workflows });
}

function openDraft(store: WorkflowDraftStore, rawName: string | undefined): AgentToolResult<any> {
  const workflowName = rawName?.trim();
  if (!workflowName) return failure('workflowName is required for open_draft.');
  const catalog = createWorkflowCatalog();
  let graph = createStarterWorkflowGraph();
  let manifest = createStarterWorkflowManifest(workflowName);
  let baseRevision = 0;
  if (catalog.list().some((entry) => entry.name === workflowName)) {
    const definition = catalog.load(workflowName);
    graph = definition.graph;
    manifest = {
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
    baseRevision = definition.revision;
  }
  const draft = store.save({ workflowName, graph, manifest, baseRevision });
  return success(`Opened durable draft ${draft.id} for ${workflowName}.`, { draft });
}

function requireDraft(store: WorkflowDraftStore, draftId: string | undefined) {
  const id = draftId?.trim();
  if (!id) throw new Error('draftId is required for this action.');
  const draft = store.get(id);
  if (!draft) throw new Error('Workflow draft not found.');
  return draft;
}

function validateDraft(draft: NonNullable<ReturnType<WorkflowDraftStore['get']>>): AgentToolResult<any> {
  const validation = validateWorkflowDefinitionInput({ name: draft.workflowName, graph: draft.graph, manifest: draft.manifest });
  const text = validation.valid
    ? `Workflow draft is valid${validation.warnings.length ? ` with ${validation.warnings.length} warning(s)` : ''}.`
    : `Workflow draft is invalid: ${validation.errors.map((issue) => issue.message).join(' ')}`;
  return validation.valid
    ? success(text, { validation, updatedAtMs: draft.updatedAtMs })
    : failure(text, { validation, updatedAtMs: draft.updatedAtMs });
}

function replaceDraft(
  store: WorkflowDraftStore,
  draft: NonNullable<ReturnType<WorkflowDraftStore['get']>>,
  input: WorkflowManageInput,
): AgentToolResult<any> {
  if (!input.graph) return failure('graph is required for replace_draft.');
  if (input.expectedUpdatedAtMs === undefined) return failure('expectedUpdatedAtMs is required for replace_draft.');
  const workflowName = input.workflowName?.trim() || draft.workflowName;
  const manifest = input.manifest ?? draft.manifest;
  const validation = validateWorkflowDefinitionInput({ name: workflowName, graph: input.graph, manifest });
  if (!validation.valid) return failure(`Draft was not changed. ${validation.errors.map((issue) => issue.message).join(' ')}`, { validation });
  try {
    const saved = store.save({ id: draft.id, workflowName, graph: input.graph, manifest, expectedUpdatedAtMs: input.expectedUpdatedAtMs });
    return success(`Workflow draft saved at version ${saved.updatedAtMs}.`, { draft: saved, validation });
  } catch (error) {
    if (error instanceof WorkflowDraftConflictError) {
      return failure('Draft changed since it was read. Read it again before applying changes.', { code: 'WORKFLOW_DRAFT_CONFLICT', currentUpdatedAtMs: error.currentUpdatedAtMs });
    }
    throw error;
  }
}

function publishDraft(
  store: WorkflowDraftStore,
  draft: NonNullable<ReturnType<WorkflowDraftStore['get']>>,
  expectedUpdatedAtMs: number | undefined,
  confirmed: boolean | undefined,
): AgentToolResult<any> {
  if (confirmed !== true) return failure('Publishing requires explicit user confirmation. Ask the user to confirm this validated draft first.');
  if (expectedUpdatedAtMs === undefined) return failure('expectedUpdatedAtMs is required for publish_draft.');
  if (draft.updatedAtMs !== expectedUpdatedAtMs) return failure('Draft changed since it was read. Read and validate it again before publishing.', { code: 'WORKFLOW_DRAFT_CONFLICT', currentUpdatedAtMs: draft.updatedAtMs });
  const validation = validateWorkflowDefinitionInput({ name: draft.workflowName, graph: draft.graph, manifest: draft.manifest });
  if (!validation.valid) return failure(`Workflow was not published. ${validation.errors.map((issue) => issue.message).join(' ')}`, { validation });
  try {
    const { definition } = createWorkflowCatalog().save({
      name: draft.workflowName, graph: draft.graph, manifest: draft.manifest,
      expectedRevision: draft.baseRevision, intent: draft.baseRevision === 0 ? 'create' : 'update',
    });
    store.save({ ...draft, baseRevision: definition.revision, expectedUpdatedAtMs: draft.updatedAtMs });
    const delivery: ProductDeliveryEnvelope = {
      version: PRODUCT_DELIVERY_VERSION,
      operation: draft.baseRevision === 0 ? 'created' : 'updated',
      primary: { kind: 'workflow_definition', id: definition.id, title: definition.title, summary: definition.description, status: 'ready', capabilities: ['open', 'edit', 'run'] },
    };
    return success(appendProductDeliveryText(`Published workflow \`${definition.name}\` revision ${definition.revision}.`, delivery), { definition, delivery });
  } catch (error) {
    if (error instanceof WorkflowNameConflictError) return failure(`Workflow name "${error.workflowName}" is already in use.`, { code: 'WORKFLOW_NAME_EXISTS' });
    if (error instanceof WorkflowRevisionConflictError) return failure('The saved workflow changed. Open a fresh draft before publishing.', { code: 'WORKFLOW_REVISION_CONFLICT', currentRevision: error.currentRevision });
    throw error;
  }
}

function success(text: string, details: Record<string, unknown>): AgentToolResult<any> {
  return { content: [{ type: 'text', text }], details };
}

function failure(message: string, details: Record<string, unknown> = {}): AgentToolResult<any> {
  return { content: [{ type: 'text', text: message }], details: { error: message, ...details } };
}
