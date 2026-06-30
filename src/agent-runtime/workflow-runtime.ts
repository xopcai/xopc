import type { EffectiveAgentManifest } from '../agent-manifest/schema.js';
import type { RuntimeToolRegistry } from './tool-registry.js';

export interface WorkflowPhaseDefinition {
  id: string;
  modelRole?: string;
  requiredTools?: string[];
}

export interface WorkflowCatalogEntry {
  id: string;
  description?: string;
  phases: WorkflowPhaseDefinition[];
}

export interface ResolveWorkflowParams {
  manifest: EffectiveAgentManifest;
  catalog: Iterable<WorkflowCatalogEntry>;
  intent?: string;
}

export interface WorkflowResolution {
  workflow?: WorkflowCatalogEntry;
  reason: string;
}

export interface WorkflowValidationIssue {
  path: string;
  message: string;
}

export function resolveWorkflow(params: ResolveWorkflowParams): WorkflowResolution {
  const catalog = new Map([...params.catalog].map((workflow) => [workflow.id, workflow]));
  const intent = params.intent?.trim().toLowerCase();
  const suggested = intent
    ? params.manifest.workflows.suggested?.find((entry) => entry.intent.toLowerCase() === intent)
    : undefined;
  const id = suggested?.workflow ?? params.manifest.workflows.default;
  if (!id) {
    return { reason: 'no workflow configured' };
  }
  if (params.manifest.workflows.allowed && !params.manifest.workflows.allowed.includes(id)) {
    return { reason: `workflow "${id}" is not allowed by manifest` };
  }
  const workflow = catalog.get(id);
  if (!workflow) {
    return { reason: `workflow "${id}" is not in the workflow catalog` };
  }
  return {
    workflow,
    reason: suggested ? `matched intent "${suggested.intent}"` : 'using default workflow',
  };
}

export function validateWorkflowForRuntime(params: {
  manifest: EffectiveAgentManifest;
  workflow: WorkflowCatalogEntry;
  tools: RuntimeToolRegistry;
}): WorkflowValidationIssue[] {
  const issues: WorkflowValidationIssue[] = [];
  const availableTools = new Set(params.tools.tools.map((entry) => entry.name));
  for (const [phaseIndex, phase] of params.workflow.phases.entries()) {
    if (phase.modelRole && !params.manifest.models.roles[phase.modelRole]) {
      issues.push({
        path: `phases.${phaseIndex}.modelRole`,
        message: `model role "${phase.modelRole}" is not configured`,
      });
    }
    for (const toolName of phase.requiredTools ?? []) {
      if (!availableTools.has(toolName)) {
        issues.push({
          path: `phases.${phaseIndex}.requiredTools`,
          message: `required tool "${toolName}" is not available at runtime`,
        });
      }
    }
  }
  return issues;
}
