import type { AgentMessage } from '@earendil-works/pi-agent-core';

export const ACCEPTANCE_REPAIR_READ_TOOLS = new Set(['read_file', 'find', 'grep', 'list_dir', 'tool_manual', 'tool_search',
  'review_workspace', 'language_diagnostics', 'session_status', 'web_fetch', 'web_extract', 'web_search', 'read_media',
  'data_batch', 'task_collaboration', 'publish_task_result']);

// A missing result can be retried only for tools with no external write operation.
export const RECOVERY_READ_TOOLS = new Set(['read_file', 'list_dir', 'find', 'grep']);

export type UnconfirmedToolEffect = {
  cause: 'aborted_turn' | 'failed_tool' | 'missing_tool_result';
  toolCallId?: string;
  toolName?: string;
};

type RecoveryOptions = {
  allowFailedReadTools?: ReadonlySet<string>;
  allowMissingReadTools?: ReadonlySet<string>;
};

export function findUnconfirmedToolEffect(rows: readonly unknown[], options?: RecoveryOptions): UnconfirmedToolEffect | undefined {
  const messages = rows.filter((row): row is Record<string, unknown> => !!row && typeof row === 'object');
  const pending = new Map<string, { name?: string; arguments?: Record<string, unknown> }>();
  for (const message of messages.slice(Math.max(0, messages.findLastIndex(item => item.role === 'user')))) {
    if (message.role === 'assistant') {
      if (message.stopReason === 'aborted') return { cause: 'aborted_turn' };
      if (message.stopReason === 'error') continue;
      for (const block of Array.isArray(message.content) ? message.content : []) {
        if (block?.type === 'toolCall' && typeof block.id === 'string') pending.set(block.id, block);
      }
    } else if (message.role === 'toolResult') {
      // A synthesized or failed result cannot prove that an external effect did not occur.
      const recordedReplay = Array.isArray(message.content) && message.content.some(block => block?.type === 'text'
        && typeof block.text === 'string' && block.text.startsWith('This operation already completed before recovery.'));
      const call = typeof message.toolCallId === 'string' ? pending.get(message.toolCallId) : undefined;
      // Collaboration also posts messages and can materialize files. Only exempt the original read call.
      const readOnly = options?.allowFailedReadTools?.has(String(message.toolName))
        && (message.toolName !== 'task_collaboration' || (call?.name === message.toolName
          && call.arguments?.command === 'get'
          && (call.arguments.materialize === undefined || call.arguments.materialize === false)));
      if (message.isError && !recordedReplay && !readOnly) {
        return { cause: 'failed_tool',
          ...(typeof message.toolCallId === 'string' ? { toolCallId: message.toolCallId } : {}),
          ...(typeof message.toolName === 'string' ? { toolName: message.toolName } : {}),
        };
      }
      if (typeof message.toolCallId === 'string') pending.delete(message.toolCallId);
    }
  }
  for (const [toolCallId, call] of pending) {
    if (call.name && options?.allowMissingReadTools?.has(call.name)) continue;
    return { cause: 'missing_tool_result', toolCallId, ...(call.name ? { toolName: call.name } : {}) };
  }
  return undefined;
}

export function canResumeAfterModelFailure(rows: readonly unknown[], options?: RecoveryOptions): boolean {
  return findUnconfirmedToolEffect(rows, options) === undefined;
}

export function recoveryToolKey(name: string, args: unknown): string {
  return JSON.stringify([name, args], (_key, value) => value && typeof value === 'object' && !Array.isArray(value)
    ? Object.fromEntries(Object.entries(value).sort(([a], [b]) => a.localeCompare(b))) : value);
}

/** Prevent a recovering model from replaying an already confirmed operation with a new call ID. */
export function completedRecoveryToolResult(messages: readonly AgentMessage[], name: string, args: unknown): string | undefined {
  const calls = new Map<string, string>();
  const key = recoveryToolKey(name, args);
  for (const message of messages.slice(Math.max(0, messages.findLastIndex(item => item.role === 'user')))) {
    if (message.role === 'assistant' && message.stopReason !== 'error' && message.stopReason !== 'aborted') {
      for (const block of message.content) {
        if (block.type === 'toolCall') calls.set(block.id, recoveryToolKey(block.name, block.arguments));
      }
    } else if (message.role === 'toolResult' && !message.isError && calls.get(message.toolCallId) === key) {
      return `This operation already completed before recovery. Do not execute it again. Use its recorded result and continue the remaining work:\n${JSON.stringify(message.content).slice(0, 8000)}`;
    }
  }
  return undefined;
}
