import { AsyncLocalStorage } from 'node:async_hooks';
import type { AgentTool } from '@earendil-works/pi-agent-core';
import type { AgentTurnPolicyOptions } from './agent-turn-policy.js';

interface DelegationScope {
  tools: AgentTool<any, any>[];
  authorizeToolCall?: AgentTurnPolicyOptions['authorizeToolCall'];
}
const storage = new AsyncLocalStorage<DelegationScope>();

export function withDelegationScope<T>(scope: DelegationScope, run: () => T): T {
  return storage.run(scope, run);
}

export function getDelegationScope(): DelegationScope | undefined {
  return storage.getStore();
}
