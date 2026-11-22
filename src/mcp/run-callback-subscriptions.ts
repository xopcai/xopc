import type { Config } from '../config/schema.js';
import { DurableState } from '../storage/sqlite/durable-state.js';
import { resolveMcpCallbackSecret, type McpConnectionCallback } from './callback-config.js';

export type CallbackConfig = Config['gateway']['mcpCallback'];
export type ResolvedCallbackTarget = CallbackConfig | McpConnectionCallback;
type Subscription = {
  principalId: string;
  url: string;
  perConnection?: boolean;
  sequence: number;
  attempts: number;
  nextAttemptAt: number;
};

export const mcpRunCallbackSubscriptions = new DurableState<Subscription>('mcp-run-callback');

export function subscribeToMcpRunCallback(
  runId: string,
  principalId: string,
  config: ResolvedCallbackTarget,
  options: { perConnection?: boolean } = {},
): boolean {
  if (!config || !resolveMcpCallbackSecret(config)) return false;
  mcpRunCallbackSubscriptions.set(runId, {
    principalId,
    url: config.url,
    ...(options.perConnection ? { perConnection: true } : {}),
    sequence: 0,
    attempts: 0,
    nextAttemptAt: 0,
  });
  return true;
}
