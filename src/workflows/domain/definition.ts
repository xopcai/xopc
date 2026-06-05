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
  metadata: WorkflowDefinitionMetadata;
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

export interface WorkflowDefinitionMetadata {
  tags: string[];
  builtIn: boolean;
  createdAtMs: number;
  updatedAtMs: number;
}
