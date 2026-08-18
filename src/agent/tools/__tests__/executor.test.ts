import type { AgentTool } from '@earendil-works/pi-agent-core';
import { describe, expect, it } from 'vitest';

import { executeToolWithProtection } from '../executor.js';

describe('executeToolWithProtection', () => {
  it('uses the effective agent policy timeout before tool hints and defaults', async () => {
    const tool = {
      name: 'policy_tool',
      description: 'policy timeout test',
      parameters: { type: 'object', properties: {} },
      timeoutMs: 5_000,
      execute: async (_callId: string, _params: unknown, signal?: AbortSignal) => {
        await new Promise<void>((resolve) => signal?.addEventListener('abort', () => resolve(), { once: true }));
        return { content: [{ type: 'text' as const, text: 'stopped' }], details: {} };
      },
    } as AgentTool<any, Record<string, never>>;

    await expect(executeToolWithProtection(tool, 'call-policy', {}, undefined, undefined, {
      defaultTimeoutMs: 10_000,
      resolveTimeoutMs: (name) => name === 'policy_tool' ? 10 : undefined,
      enableRetry: false,
    })).rejects.toThrow("timed out after 10ms");
  });

  it('aborts the signal passed to a tool when its timeout elapses', async () => {
    let receivedSignal: AbortSignal | undefined;
    const tool = {
      name: 'blocking_tool',
      description: 'blocks until cancelled',
      parameters: { type: 'object', properties: {} },
      execute: async (_callId: string, _params: unknown, signal?: AbortSignal) => {
        receivedSignal = signal;
        await new Promise<void>((resolve) => {
          if (signal?.aborted) resolve();
          else signal?.addEventListener('abort', () => resolve(), { once: true });
        });
        return { content: [{ type: 'text' as const, text: 'stopped' }], details: {} };
      },
    } as AgentTool<any, Record<string, never>>;

    await expect(executeToolWithProtection(
      tool,
      'call-1',
      {},
      undefined,
      undefined,
      { defaultTimeoutMs: 10, enableRetry: false },
    )).rejects.toThrow("Tool 'blocking_tool' timed out");

    expect(receivedSignal?.aborted).toBe(true);
  });
});
