import type {
  WorkflowDefinition,
  WorkflowDefinitionManifest,
} from './workflow-api';

export function definitionToManifest(
  definition: WorkflowDefinition,
): WorkflowDefinitionManifest {
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
