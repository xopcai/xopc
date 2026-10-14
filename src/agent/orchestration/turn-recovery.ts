import type { AgentMessage } from '@earendil-works/pi-agent-core';

export const ACCEPTANCE_REPAIR_READ_TOOLS = new Set(['read_file', 'find', 'grep', 'list_dir', 'tool_manual', 'tool_search',
  'review_workspace', 'language_diagnostics', 'session_status', 'web_fetch', 'web_extract', 'web_search', 'read_media', 'publish_task_result']);

/** A model request can be resumed only after every issued tool has a confirmed result. */
export function canResumeAfterModelFailure(rows: readonly unknown[], options?: { allowFailedReadTools?: ReadonlySet<string> }): boolean {
  const messages = rows.filter((row): row is Record<string, unknown> => !!row && typeof row === 'object');
  const pending = new Set<string>();
  for (const message of messages.slice(Math.max(0, messages.findLastIndex(item => item.role === 'user')))) {
    if (message.role === 'assistant') {
      if (message.stopReason === 'aborted') return false;
      if (message.stopReason === 'error') continue;
      for (const block of Array.isArray(message.content) ? message.content : []) {
        if (block?.type === 'toolCall' && typeof block.id === 'string') pending.add(block.id);
      }
    } else if (message.role === 'toolResult') {
      // A synthesized or failed result cannot prove that an external effect did not occur.
      const recordedReplay = Array.isArray(message.content) && message.content.some(block => block?.type === 'text'
        && typeof block.text === 'string' && block.text.startsWith('This operation already completed before recovery.'));
      if (message.isError && !recordedReplay && !options?.allowFailedReadTools?.has(String(message.toolName))) return false;
      if (typeof message.toolCallId === 'string') pending.delete(message.toolCallId);
    }
  }
  return pending.size === 0;
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
