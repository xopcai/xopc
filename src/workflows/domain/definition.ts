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

export type WorkflowNodeKind = 'input' | 'agent' | 'decision' | 'merge' | 'output';

export interface WorkflowCanvasPosition {
  x: number;
  y: number;
}

export interface WorkflowGraphNodeBase {
  id: string;
  kind: WorkflowNodeKind;
  title: string;
  description?: string;
  phaseId?: string;
  position: WorkflowCanvasPosition;
}

export interface WorkflowInputNode extends WorkflowGraphNodeBase {
  kind: 'input';
  config: {
    schema?: JsonSchema;
  };
}

export interface WorkflowAgentNode extends WorkflowGraphNodeBase {
  kind: 'agent';
  config: {
    prompt: string;
    model?: string;
    toolset?: string[];
    maxIterations?: number;
    outputSchema?: JsonSchema;
  };
}

export interface WorkflowDecisionRule {
  path: string;
  operator: 'exists' | 'equals' | 'not_equals' | 'contains';
  value?: unknown;
}

export interface WorkflowDecisionNode extends WorkflowGraphNodeBase {
  kind: 'decision';
  config: {
    rule: WorkflowDecisionRule;
  };
}

export interface WorkflowMergeNode extends WorkflowGraphNodeBase {
  kind: 'merge';
  config: {
    mode: 'array' | 'object';
  };
}

export interface WorkflowOutputNode extends WorkflowGraphNodeBase {
  kind: 'output';
  config: {
    summary?: string;
    title?: string;
  };
}

export type WorkflowGraphNode =
  | WorkflowInputNode
  | WorkflowAgentNode
  | WorkflowDecisionNode
  | WorkflowMergeNode
  | WorkflowOutputNode;

export interface WorkflowGraphEdge {
  id: string;
  source: string;
  target: string;
  sourcePort?: 'true' | 'false' | 'default';
}

export interface WorkflowGraph {
  schemaVersion: 1;
  nodes: WorkflowGraphNode[];
  edges: WorkflowGraphEdge[];
}

export interface WorkflowDefinition {
  id: string;
  name: string;
  title: string;
  description: string;
  version: string;
  revision: number;
  contentHash?: string;
  inputSchema?: JsonSchema;
  outputSchema?: JsonSchema;
  phases: WorkflowPhaseDefinition[];
  graph: WorkflowGraph;
  defaults: WorkflowDefinitionDefaults;
  permissions?: WorkflowPermissionPolicy;
  resources?: WorkflowResourceRefs;
  connectors?: WorkflowConnectorRequirement[];
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
  estimatedAgents?: WorkflowDefinitionEstimatedAgents;
  examplePrompts?: WorkflowDefinitionExamplePrompt[];
  i18n?: Record<string, WorkflowDefinitionLocale>;
  permissions?: WorkflowPermissionPolicy;
  resources?: WorkflowResourceRefs;
  connectors?: WorkflowConnectorRequirement[];
}

export interface WorkflowConnectorRequirement {
  connectorId: string;
  scope?: 'read' | 'write' | 'admin';
  connectionRequired?: boolean;
  optional?: boolean;
  reason?: string;
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
