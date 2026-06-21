import { randomUUID } from 'node:crypto';

import { validateWorkflowDefinitionInput } from '../domain/validation.js';
import type { WorkflowDefinitionManifest } from '../domain/definition.js';

import type {
  GeneratedWorkflowDraft,
  WorkflowDraftConstraints,
  WorkflowDraftLintIssue,
  WorkflowDraftResponse,
} from './workflow-draft.types.js';

export function parseGeneratedWorkflowDraft(raw: string): GeneratedWorkflowDraft {
  const json = extractJsonObject(raw);
  const parsed = JSON.parse(json) as Partial<GeneratedWorkflowDraft>;
  const name = normalizeWorkflowName(String(parsed.name ?? 'custom_workflow'));
  const script = String(parsed.script ?? '').trim();
  const manifest = normalizeManifest(parsed.manifest);
  return {
    name,
    script,
    manifest,
    explanation: String(parsed.explanation ?? ''),
    assumptions: stringArray(parsed.assumptions),
    risks: stringArray(parsed.risks),
  };
}

export function buildWorkflowDraftResponse(
  draft: GeneratedWorkflowDraft,
  constraints?: WorkflowDraftConstraints,
): WorkflowDraftResponse {
  const validation = validateWorkflowDefinitionInput({ name: draft.name, script: draft.script });
  const lint = lintWorkflowDraft(draft, constraints);
  return {
    draftId: randomUUID(),
    repairAttempts: 0,
    ...draft,
    permissionsSummary: summarizePermissions(draft.manifest),
    validation,
    lint,
    suggestedInputs: suggestedInputsFromManifest(draft.manifest),
  };
}

export function lintWorkflowDraft(
  draft: GeneratedWorkflowDraft,
  constraints?: WorkflowDraftConstraints,
): WorkflowDraftLintIssue[] {
  const issues: WorkflowDraftLintIssue[] = [];
  const { manifest, script } = draft;
  if (!manifest.inputSchema) {
    issues.push({ severity: 'warning', code: 'missing_input_schema', message: 'Draft does not define an input schema.' });
  }
  if (!manifest.outputSchema) {
    issues.push({ severity: 'warning', code: 'missing_output_schema', message: 'Draft does not define an output schema.' });
  }
  if (manifest.permissions?.network && constraints?.allowNetwork === false) {
    issues.push({ severity: 'error', code: 'unsafe_permission', message: 'Draft requests network access, but network is disabled by constraints.' });
  }
  if (manifest.permissions?.fileSystem === 'write' && constraints?.fileSystem !== 'write') {
    issues.push({ severity: 'warning', code: 'unsafe_permission', message: 'Draft requests filesystem write access.' });
  }
  const phaseCount = (script.match(/\bphase\s*\(/g) ?? []).length;
  if (constraints?.maxPhases && phaseCount > constraints.maxPhases) {
    issues.push({ severity: 'warning', code: 'too_many_agents', message: `Draft has ${phaseCount} phases, above requested ${constraints.maxPhases}.` });
  }
  const agentCount = (script.match(/\bagent\s*\(/g) ?? []).length;
  if (constraints?.maxSubagents && agentCount > constraints.maxSubagents) {
    issues.push({ severity: 'warning', code: 'too_many_agents', message: `Draft starts ${agentCount} agents, above requested ${constraints.maxSubagents}.` });
  }
  if (/parallel\s*\([^[]/.test(script)) {
    issues.push({ severity: 'warning', code: 'unbounded_parallelism', message: 'parallel() should receive a bounded array of thunks.' });
  }
  if (constraints?.allowedTools?.length) {
    const unknown = collectToolsetNames(script).filter((tool) => !constraints.allowedTools!.includes(tool));
    for (const tool of [...new Set(unknown)]) {
      issues.push({ severity: 'warning', code: 'unknown_tool', message: `Tool '${tool}' is outside the requested allowlist.` });
    }
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

function normalizeManifest(value: unknown): WorkflowDefinitionManifest {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return {};
  return value as WorkflowDefinitionManifest;
}

function stringArray(value: unknown): string[] {
  return Array.isArray(value) ? value.map((item) => String(item)).filter(Boolean) : [];
}

function normalizeWorkflowName(value: string): string {
  const normalized = value
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '_')
    .replace(/^_+|_+$/g, '');
  return /^[a-z]/.test(normalized) ? normalized : `workflow_${normalized || 'draft'}`;
}

function summarizePermissions(manifest: WorkflowDefinitionManifest): string[] {
  const permissions = manifest.permissions;
  if (!permissions) return ['No explicit permissions requested.'];
  const out: string[] = [];
  if (permissions.tools?.length) out.push(`Tools: ${permissions.tools.join(', ')}`);
  if (permissions.network != null) out.push(`Network: ${permissions.network ? 'enabled' : 'disabled'}`);
  if (permissions.fileSystem) out.push(`Filesystem: ${permissions.fileSystem}`);
  if (permissions.approvalRequired) out.push('Approval required');
  return out.length > 0 ? out : ['No explicit permissions requested.'];
}

function suggestedInputsFromManifest(manifest: WorkflowDefinitionManifest): WorkflowDraftResponse['suggestedInputs'] {
  const properties = manifest.inputSchema?.properties;
  if (!properties) return undefined;
  return Object.entries(properties).slice(0, 8).map(([key, schema]) => ({
    key,
    label: typeof schema.title === 'string' ? schema.title : key,
    example: typeof schema.default === 'string' ? schema.default : schema.description ?? '',
  }));
}

function collectToolsetNames(script: string): string[] {
  const out: string[] = [];
  const re = /toolset\s*:\s*\[([^\]]*)\]/g;
  for (const match of script.matchAll(re)) {
    const body = match[1] ?? '';
    for (const item of body.matchAll(/['"]([^'"]+)['"]/g)) {
      out.push(item[1] ?? '');
    }
  }
  return out.filter(Boolean);
}
