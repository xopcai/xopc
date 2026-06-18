export interface JsonSchema {
  type?: string | string[];
  properties?: Record<string, JsonSchema>;
  items?: JsonSchema | JsonSchema[];
  required?: string[];
  additionalProperties?: boolean | JsonSchema;
  enum?: unknown[];
  const?: unknown;
  description?: string;
  [key: string]: unknown;
}

export interface WorkflowDefinition {
  id: string;
  name: string;
  title: string;
  description: string;
  version: string;
  inputSchema?: JsonSchema;
  outputSchema?: JsonSchema;
  phases: WorkflowPhaseDefinition[];
  runtime: WorkflowRuntimeDefinition;
  defaults: WorkflowDefinitionDefaults;
  permissions?: WorkflowPermissionPolicy;
  resources?: WorkflowResourceRefs;
  metadata: WorkflowDefinitionMetadata;
}

export interface WorkflowDefinitionManifest {
  title?: string;
  description?: string;
  version?: string;
  inputSchema?: JsonSchema;
  outputSchema?: JsonSchema;
  defaults?: Partial<WorkflowDefinitionDefaults>;
  tags?: string[];
  whenToUse?: string;
  permissions?: WorkflowPermissionPolicy;
  resources?: WorkflowResourceRefs;
}

export interface WorkflowPermissionPolicy {
  tools?: string[];
  network?: boolean;
  fileSystem?: 'read' | 'write' | 'none';
  approvalRequired?: boolean;
}

export interface WorkflowResourceRefs {
  skills?: string[];
  contextFiles?: string[];
  promptTemplates?: string[];
}

export interface WorkflowPhaseDefinition {
  id: string;
  title: string;
  description?: string;
}

export interface WorkflowRuntimeDefinition {
  kind: 'script';
  source: string;
}

export interface WorkflowDefinitionDefaults {
  concurrency: number;
  timeoutSec: number;
  maxSubagents: number;
}

export interface WorkflowDefinitionEstimatedAgents {
  min: number;
  max: number;
}

export interface WorkflowDefinitionExamplePrompt {
  field: string;
  text: string;
}

export interface WorkflowDefinitionLocale {
  description?: string;
  whenToUse?: string;
  examplePrompts?: WorkflowDefinitionExamplePrompt[];
}

export interface WorkflowDefinitionMetadata {
  tags: string[];
  builtIn: boolean;
  source: 'builtin' | 'user';
  whenToUse?: string;
  estimatedAgents?: WorkflowDefinitionEstimatedAgents;
  examplePrompts?: WorkflowDefinitionExamplePrompt[];
  i18n?: Record<string, WorkflowDefinitionLocale>;
  createdAtMs: number;
  updatedAtMs: number;
}
