import type { HomeAdvisor, HomeOpportunity } from '@xopcai/gateway-contract';

export type HomeGeneratedResult =
  | Extract<HomeAdvisor, { state: 'quiet' | 'clarification' }>
  | { state: 'ready'; opportunities: HomeOpportunity[]; placement?: 'primary' | 'compact' };

export interface HomeCapabilityInventory {
  agentId: string;
  connectors: ReadonlySet<string>;
  skills: ReadonlySet<string>;
}
