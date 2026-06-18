import type { WorkflowDefinition } from '../domain/definition.js';

export interface WorkflowDefinitionSummary {
  id: string;
  name: string;
  title: string;
  description: string;
  source: 'builtin' | 'user';
  tags?: string[];
  whenToUse?: string;
}

/** Definition source port: filesystem, built-ins, remote packages, extensions. */
export interface WorkflowDefinitionRegistry {
  list(): Promise<WorkflowDefinitionSummary[]>;
  get(id: string): Promise<WorkflowDefinition | null>;
}
