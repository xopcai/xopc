import type { AgentTool } from '@earendil-works/pi-agent-core';

import { recordPersonalPerformance } from '../../personal-agent/performance.js';

export function withPersonalPerformance<T extends AgentTool>(tool: T, conversationId?: string, taskId?: string, runId?: string, assignmentEpoch?: number): T {
  return { ...tool, execute: async (...args: Parameters<T['execute']>) => {
    const started = performance.now();
    const raw = args[1] as { command?: unknown };
    const command = typeof raw?.command === 'string' && /^[a-z_]{1,32}$/.test(raw.command) ? raw.command : undefined;
    const identity = { conversationId, taskId, runId, assignmentEpoch, tool: tool.name, toolCallId: args[0], command };
    try {
      const result = await tool.execute(args[0], args[1], args[2], args[3]);
      const details = result.details as { status?: string; failureHint?: string } | undefined;
      let payload: { status?: string; ok?: boolean } | undefined;
      if (tool.name.startsWith('personal_')) {
        const text = result.content.find(item => item.type === 'text');
        if (text?.type === 'text') { try { payload = JSON.parse(text.text); } catch { /* Non-JSON tool responses remain observable. */ } }
      }
      const failed = result.isError || payload?.ok === false
        || ['failed', 'blocked', 'error', 'invalid_reference', 'conflict', 'unavailable'].includes(payload?.status ?? details?.status ?? '');
      const status = failed ? 'error' : ['preparing', 'pending', 'running'].includes(payload?.status ?? details?.status ?? '') ? 'pending' : 'success';
      const durationMs = performance.now() - started;
      const errorCode = failed ? details?.status === 'blocked' ? 'command_blocked' as const
        : details?.failureHint?.startsWith('Shell syntax preflight') ? 'shell_syntax' as const : 'tool_error' as const : undefined;
      recordPersonalPerformance({ ...identity, phase: 'tool', durationMs, status, errorCode });
      if (tool.name === 'personal_task' && ['submit', 'revise'].includes(command ?? '')) {
        recordPersonalPerformance({ ...identity, phase: 'local_write', durationMs, status });
      }
      if (tool.name === 'personal_result' && ['read', 'search'].includes(command ?? '') && status !== 'pending') {
        recordPersonalPerformance({ ...identity, phase: 'hot_read', durationMs, status });
      }
      return result;
    } catch (error) {
      let errorCode: 'source_quote_mismatch' | 'tool_error' = 'tool_error';
      if (error instanceof Error) { try { if (JSON.parse(error.message).code === 'source_quote_mismatch') errorCode = 'source_quote_mismatch'; } catch { /* Do not log arbitrary exception text. */ } }
      recordPersonalPerformance({ ...identity, phase: 'tool', durationMs: performance.now() - started, status: args[2]?.aborted ? 'cancelled' : 'error', errorCode });
      throw error;
    }
  } } as T;
}
