import type { AgentDefaults, AgentEntry } from '../agent-config/index.js';
import type { BindingRule } from '../routing/binding-schema.js';

export type AgentProvisioningState = 'pending' | 'ready' | 'error';

export interface StoredAgent extends AgentEntry {
  revision: number;
  provisioningState: AgentProvisioningState;
  provisioningError?: string;
  createdAt: number;
  updatedAt: number;
  deletedAt?: number;
}

export interface AgentCatalogSnapshot {
  revision: number;
  defaultAgentId: string;
  defaults: AgentDefaults;
  agents: AgentEntry[];
  bindings: BindingRule[];
  surfaceDefaults: Record<string, string>;
}

export interface AgentCatalogSettings {
  defaultAgentId: string;
  defaults: AgentDefaults;
  revision: number;
  createdAt: number;
  updatedAt: number;
}

