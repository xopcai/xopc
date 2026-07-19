import { randomUUID } from 'node:crypto';

import type { WorkflowDefinitionManifest, WorkflowGraph } from '../domain/definition.js';
import { validateWorkflowDefinitionInput } from '../domain/validation.js';

import type { GeneratedWorkflowDraft, WorkflowDraftConstraints, WorkflowDraftLintIssue, WorkflowDraftResponse } from './workflow-draft.types.js';

export function parseGeneratedWorkflowDraft(raw: string): GeneratedWorkflowDraft {
  const parsed = JSON.parse(extractJsonObject(raw)) as Partial<GeneratedWorkflowDraft>;
  return {
    name: normalizeWorkflowName(String(parsed.name ?? 'custom_workflow')),
    graph: normalizeGraph(parsed.graph),
    manifest: normalizeManifest(parsed.manifest),
    explanation: String(parsed.explanation ?? ''),
    assumptions: stringArray(parsed.assumptions),
    risks: stringArray(parsed.risks),
  };
}

export function buildWorkflowDraftResponse(draft: GeneratedWorkflowDraft, constraints?: WorkflowDraftConstraints): WorkflowDraftResponse {
  const validation = validateWorkflowDefinitionInput({ name: draft.name, graph: draft.graph });
  return {
    draftId: randomUUID(),
    repairAttempts: 0,
    ...draft,
    permissionsSummary: summarizePermissions(draft.manifest),
    validation,
    lint: lintWorkflowDraft(draft, constraints),
    suggestedInputs: suggestedInputsFromManifest(draft.manifest),
  };
}

export function lintWorkflowDraft(draft: GeneratedWorkflowDraft, constraints?: WorkflowDraftConstraints): WorkflowDraftLintIssue[] {
  const issues: WorkflowDraftLintIssue[] = [];
  const { manifest, graph } = draft;
  if (!manifest.inputSchema) issues.push({ severity: 'warning', code: 'missing_input_schema', message: 'Draft does not define an input schema.' });
  if (!manifest.outputSchema) issues.push({ severity: 'warning', code: 'missing_output_schema', message: 'Draft does not define an output schema.' });
  if (manifest.permissions?.network && constraints?.allowNetwork === false) issues.push({ severity: 'error', code: 'unsafe_permission', message: 'Draft requests network access, but network is disabled.' });
  if (manifest.permissions?.fileSystem === 'write' && constraints?.fileSystem !== 'write') issues.push({ severity: 'warning', code: 'unsafe_permission', message: 'Draft requests filesystem write access.' });
  const phases = new Set(graph.nodes.map((node) => node.phaseId).filter(Boolean));
  if (constraints?.maxPhases && phases.size > constraints.maxPhases) issues.push({ severity: 'warning', code: 'too_many_agents', message: `Draft has ${phases.size} phases, above the requested maximum.` });
  const agents = graph.nodes.filter((node) => node.kind === 'agent');
  if (constraints?.maxSubagents && agents.length > constraints.maxSubagents) issues.push({ severity: 'warning', code: 'too_many_agents', message: `Draft has ${agents.length} agents, above the requested maximum.` });
  if (constraints?.allowedTools?.length) {
    const unknown = agents.flatMap((node) => node.config.toolset ?? []).filter((tool) => !constraints.allowedTools!.includes(tool));
    for (const tool of [...new Set(unknown)]) issues.push({ severity: 'warning', code: 'unknown_tool', message: `Tool '${tool}' is outside the requested allowlist.` });
  }
  return issues;
}

function extractJsonObject(raw: string): string {
  const trimmed = raw.trim();
  if (trimmed.startsWith('{') && trimmed.endsWith('}')) return trimmed;
  const fenced = trimmed.match(/```(?:json)?\s*([\s\S]*?)```/i)?.[1]?.trim();
  if (fenced?.startsWith('{')) return fenced;
  const start = trimmed.indexOf('{');
  const end = trimmed.lastIndexOf('}');
  if (start >= 0 && end > start) return trimmed.slice(start, end + 1);
  throw new Error('Model did not return a JSON object.');
}

function normalizeGraph(value: unknown): WorkflowGraph {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return { schemaVersion: 1, nodes: [], edges: [] };
  return value as WorkflowGraph;
}

function normalizeManifest(value: unknown): WorkflowDefinitionManifest {
  return value && typeof value === 'object' && !Array.isArray(value) ? value as WorkflowDefinitionManifest : {};
}

function stringArray(value: unknown): string[] {
  return Array.isArray(value) ? value.map(String).filter(Boolean) : [];
}

function normalizeWorkflowName(value: string): string {
  const normalized = value.trim().toLowerCase().replace(/[^a-z0-9]+/g, '_').replace(/^_+|_+$/g, '');
  return /^[a-z]/.test(normalized) ? normalized : `workflow_${normalized || 'draft'}`;
}

function summarizePermissions(manifest: WorkflowDefinitionManifest): string[] {
  const permissions = manifest.permissions;
  if (!permissions) return ['No explicit permissions requested.'];
  const values: string[] = [];
  if (permissions.tools?.length) values.push(`Tools: ${permissions.tools.join(', ')}`);
  if (permissions.network != null) values.push(`Network: ${permissions.network ? 'enabled' : 'disabled'}`);
  if (permissions.fileSystem) values.push(`Filesystem: ${permissions.fileSystem}`);
  if (permissions.approvalRequired) values.push('Approval required');
  return values.length ? values : ['No explicit permissions requested.'];
}

function suggestedInputsFromManifest(manifest: WorkflowDefinitionManifest): WorkflowDraftResponse['suggestedInputs'] {
  const properties = manifest.inputSchema?.properties;
  if (!properties) return undefined;
  return Object.entries(properties).slice(0, 8).map(([key, schema]) => ({ key, label: typeof schema.title === 'string' ? schema.title : key, example: typeof schema.default === 'string' ? schema.default : schema.description ?? '' }));
}
