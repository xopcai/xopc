import type { Config } from '../config/schema.js';
import { DurableState } from '../storage/sqlite/durable-state.js';

export type CallbackConfig = Config['gateway']['mcpCallback'];
type Subscription = { principalId: string; url: string; sequence: number; attempts: number; nextAttemptAt: number };
export const mcpRunCallbackSubscriptions = new DurableState<Subscription>('mcp-run-callback');

export function subscribeToMcpRunCallback(runId: string, principalId: string, config: CallbackConfig): boolean {
  if (!config || !process.env[config.secretEnv]) return false;
  mcpRunCallbackSubscriptions.set(runId, { principalId, url: config.url, sequence: 0, attempts: 0, nextAttemptAt: 0 });
  return true;
}
