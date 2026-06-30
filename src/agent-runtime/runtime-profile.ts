import {
  buildAgentManifestPromptSection,
  type EffectiveAgentManifest,
} from '../agent-manifest/index.js';
import { checkBoundary } from './boundary-guard.js';
import { buildMemoryRuntime, type MemoryRuntime } from './memory-runtime.js';
import { resolveModelRole } from './model-router.js';
import {
  buildRuntimeToolRegistry,
  type RuntimeToolRegistry,
  type ToolCatalogEntry,
} from './tool-registry.js';
import {
  resolveWorkflow,
  validateWorkflowForRuntime,
  type WorkflowCatalogEntry,
  type WorkflowResolution,
  type WorkflowValidationIssue,
} from './workflow-runtime.js';

export interface AgentRuntimeProfile<TTool = unknown> {
  manifest: EffectiveAgentManifest;
  promptSections: {
    capability: string;
  };
  tools: RuntimeToolRegistry<TTool>;
  memory: MemoryRuntime;
  resolveModel: (role?: string) => ReturnType<typeof resolveModelRole>;
  checkBoundary: (action: string, detail?: string) => ReturnType<typeof checkBoundary>;
  resolveWorkflow: (intent?: string) => WorkflowResolution;
  validateWorkflow: (workflow: WorkflowCatalogEntry) => WorkflowValidationIssue[];
}

export interface BuildAgentRuntimeProfileParams<TTool = unknown> {
  manifest: EffectiveAgentManifest;
  toolCatalog: Iterable<ToolCatalogEntry<TTool>>;
  workflowCatalog?: Iterable<WorkflowCatalogEntry>;
}

export function buildAgentRuntimeProfile<TTool = unknown>(
  params: BuildAgentRuntimeProfileParams<TTool>,
): AgentRuntimeProfile<TTool> {
  const workflowCatalog = [...(params.workflowCatalog ?? [])];
  const tools = buildRuntimeToolRegistry({
    manifest: params.manifest,
    catalog: params.toolCatalog,
  });
  return {
    manifest: params.manifest,
    promptSections: {
      capability: buildAgentManifestPromptSection(params.manifest),
    },
    tools,
    memory: buildMemoryRuntime(params.manifest),
    resolveModel: (role?: string) => resolveModelRole({ manifest: params.manifest, role }),
    checkBoundary: (action: string, detail?: string) => checkBoundary({ manifest: params.manifest, action, detail }),
    resolveWorkflow: (intent?: string) => resolveWorkflow({ manifest: params.manifest, catalog: workflowCatalog, intent }),
    validateWorkflow: (workflow: WorkflowCatalogEntry) =>
      validateWorkflowForRuntime({ manifest: params.manifest, workflow, tools }),
  };
}
