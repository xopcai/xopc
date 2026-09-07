import type { EventCondition, ScenarioRoute } from '../routing/types.js';

export interface ScenarioDefinition {
  key: string;
  version: number;
  title: string;
  description: string;
  basePrompt: string;
  baseTemplateVersion: number;
  eventTypes: string[];
  condition?: EventCondition;
  aggregation: ScenarioRoute['aggregation'];
  debounceSeconds: number;
  maxWindowSeconds: number;
  contextProviderIds: string[];
  valuePolicy: {
    minConfidence: number;
    minScore: number;
    cooldownSeconds: number;
    maxRunsPerDay: number;
  };
}

export interface ScenarioSubscription {
  id: string;
  scenarioKey: string;
  workspaceId: string;
  scopeKind: 'workspace' | 'project';
  scopeId: string;
  enabled: boolean;
  activePromptRevisionId?: string;
  createdAt: string;
  updatedAt: string;
}

export interface PromptRevision {
  id: string;
  subscriptionId: string;
  revision: number;
  status: 'draft' | 'published' | 'retired';
  baseTemplateVersion: number;
  userInstructions: string;
  contentHash: string;
  createdAt: string;
  publishedAt?: string;
}
