import { AsyncLocalStorage } from 'node:async_hooks';
import type { AiUsageModel } from '../usage/types.js';

export interface ExecutionAuthority {
  revision: string;
  unrestrictedTools: boolean;
  assertCurrent(): void;
  allowsTool(name: string): boolean;
  assertTool?(name: string, args: unknown): void;
  reserveModel(model: AiUsageModel): void;
}
const authority = new AsyncLocalStorage<ExecutionAuthority>();
export const getExecutionAuthority = () => authority.getStore();
/** Trusted execution entry points may only narrow a parent authority. */
export function withExecutionAuthority<T>(value: ExecutionAuthority, execute: () => T): T {
  const parent = authority.getStore();
  return authority.run(parent ? {
    ...value, unrestrictedTools: parent.unrestrictedTools && value.unrestrictedTools,
    assertCurrent() { parent.assertCurrent(); value.assertCurrent(); },
    allowsTool: name => parent.allowsTool(name) && value.allowsTool(name),
    assertTool(name, args) { parent.assertTool?.(name, args); value.assertTool?.(name, args); },
    reserveModel(model) { parent.reserveModel(model); value.reserveModel(model); },
  } : value, execute);
}
