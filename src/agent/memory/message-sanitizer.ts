/**
 * Message Sanitizer - Cleans messages before saving to history
 *
 * Handles edge cases where LLM API calls fail and produce invalid messages
 * that would cause subsequent API calls to fail (creating a vicious cycle).
 *
 * Key issues addressed:
 * - Empty content from API errors
 * - Messages with stopReason: "error"
 * - Messages with errorMessage field
 * - Invalid tool_call_id references
 */

import type { AgentMessage } from '@mariozechner/pi-agent-core';
import { createLogger } from '../../utils/logger.js';

const log = createLogger('MessageSanitizer');

/**
 * Single multimodal / structured block is meaningful for history persistence.
 * Handles blocks without `type` (e.g. { data, mimeType } only) that some providers emit.
 */
function isMeaningfulContentBlock(item: unknown): boolean {
  if (typeof item === 'string') {
    return item.trim().length > 0;
  }
  if (!item || typeof item !== 'object') {
    return false;
  }
  const o = item as Record<string, unknown>;
  const t = o.type;

  if (t === 'text') {
    return String(o.text ?? '').trim().length > 0;
  }
  if (t === 'toolCall') {
    return String(o.name ?? '').trim().length > 0;
  }
  if (t === 'thinking') {
    return true;
  }
  if (
    t === 'image' ||
    t === 'image_url' ||
    t === 'input_image' ||
    t === 'file' ||
    t === 'audio' ||
    t === 'video'
  ) {
    return true;
  }
  if (o.image_url !== undefined || o.imageUrl !== undefined) {
    return true;
  }
  if (o.inlineData !== undefined || o.inline_data !== undefined) {
    return true;
  }
  if (typeof o.data === 'string' && o.data.length > 0 && typeof o.mimeType === 'string') {
    return true;
  }
  if (typeof t === 'string' && t.length > 0) {
    return true;
  }
  return false;
}

/**
 * Check if a message has valid, non-empty content
 */
function hasValidContent(message: AgentMessage): boolean {
  const msg = message as AgentMessage & {
    tool_calls?: unknown[];
    toolCalls?: unknown[];
  };
  if (message.role === 'assistant') {
    if (Array.isArray(msg.tool_calls) && msg.tool_calls.length > 0) return true;
    if (Array.isArray(msg.toolCalls) && msg.toolCalls.length > 0) return true;
  }

  const content = message.content;

  // String content must be non-empty
  if (typeof content === 'string') {
    return content.trim().length > 0;
  }

  // Array content must have at least one meaningful item
  if (Array.isArray(content)) {
    return content.some((item) => isMeaningfulContentBlock(item));
  }

  return false;
}

/**
 * Check if a message is an error message from a failed LLM call
 */
function isErrorMessage(message: AgentMessage): boolean {
  // Only check assistant messages
  if (message.role !== 'assistant') {
    return false;
  }

  // Check for explicit error indicators
  const msg = message as any;
  if (msg.stopReason === 'error' || msg.stopReason === 'aborted') {
    return true;
  }

  // Check for errorMessage field (added by pi-agent-core on API errors)
  if (msg.errorMessage) {
    return true;
  }

  return false;
}

/**
 * Check if a message might cause issues in subsequent API calls
 */
function isProblematicMessage(message: AgentMessage): boolean {
  // Only check assistant messages
  if (message.role !== 'assistant') {
    return false;
  }

  // Error messages are problematic
  if (isErrorMessage(message)) {
    return true;
  }

  // Empty content is problematic
  if (!hasValidContent(message)) {
    return true;
  }

  return false;
}

/**
 * Options for message sanitization
 */
export interface SanitizeOptions {
  /** Remove error messages (default: true) */
  removeErrors?: boolean;
  /** Remove empty messages (default: true) */
  removeEmpty?: boolean;
  /** Keep at least N recent messages (default: 0) */
  keepRecent?: number;
  /** Log removed messages (default: true in development) */
  logRemovals?: boolean;
}

/**
 * Result of sanitization
 */
export interface SanitizeResult {
  /** Sanitized messages */
  messages: AgentMessage[];
  /** Number of messages removed */
  removed: number;
  /** Reasons for removal */
  reasons: Array<{ index: number; reason: string }>;
}

/**
 * Sanitize messages before saving to history.
 *
 * Removes:
 * - Assistant messages with stopReason: "error" or "aborted"
 * - Assistant messages with errorMessage field
 * - Assistant messages with empty/invalid content
 *
 * @param messages - Messages to sanitize
 * @param options - Sanitization options
 * @returns Sanitized messages and removal details
 */
export function sanitizeMessages(
  messages: AgentMessage[],
  options: SanitizeOptions = {}
): SanitizeResult {
  const {
    removeErrors = true,
    removeEmpty = true,
    keepRecent = 0,
    logRemovals = process.env.NODE_ENV !== 'test',
  } = options;

  const reasons: Array<{ index: number; reason: string }> = [];
  const result: AgentMessage[] = [];

  // Track recent messages to preserve
  const preserveIndices = new Set<number>();
  if (keepRecent > 0) {
    for (let i = Math.max(0, messages.length - keepRecent); i < messages.length; i++) {
      preserveIndices.add(i);
    }
  }

  for (let i = 0; i < messages.length; i++) {
    const message = messages[i];
    const originalIndex = i;

    // Skip non-assistant messages
    if (message.role !== 'assistant') {
      result.push(message);
      continue;
    }

    // Check if this message should be preserved (recent message)
    if (preserveIndices.has(i)) {
      result.push(message);
      continue;
    }

    // Check for error messages
    if (removeErrors && isErrorMessage(message)) {
      reasons.push({
        index: originalIndex,
        reason: `Error message: stopReason=${message.stopReason}, errorMessage=${(message as any).errorMessage || 'none'}`,
      });
      continue;
    }

    // Check for empty content
    if (removeEmpty && !hasValidContent(message)) {
      reasons.push({
        index: originalIndex,
        reason: 'Empty or invalid content',
      });
      continue;
    }

    result.push(message);
  }

  const removed = messages.length - result.length;

  if (logRemovals && removed > 0) {
    log.info(
      {
        removed,
        original: messages.length,
        sanitized: result.length,
        reasons: reasons.slice(0, 5), // Log first 5 reasons
      },
      'Sanitized messages'
    );
  }

  return { messages: result, removed, reasons };
}

/**
 * Clean trailing error messages from message history.
 *
 * This is useful for cleaning up after a failed turn, ensuring
 * the conversation can continue from the last valid state.
 *
 * @param messages - Messages to clean
 * @returns Cleaned messages
 */
export function cleanTrailingErrors(messages: AgentMessage[]): AgentMessage[] {
  const result = [...messages];

  // Remove trailing error/empty messages
  while (result.length > 0) {
    const last = result[result.length - 1];
    if (last.role === 'assistant' && isProblematicMessage(last)) {
      const msg = last as any;
      log.debug({ stopReason: msg.stopReason }, 'Removing trailing error message');
      result.pop();
    } else {
      break;
    }
  }

  return result;
}

/**
 * Validate a single message for potential issues.
 * Returns null if valid, or an error description if problematic.
 */
export function validateMessage(message: AgentMessage): string | null {
  if (message.role === 'assistant') {
    if (isErrorMessage(message)) {
      const msg = message as any;
      return `Error message: stopReason=${msg.stopReason}`;
    }
    if (!hasValidContent(message)) {
      return 'Empty or invalid content';
    }
  }

  // Check for tool result messages with error indicators
  if (message.role === 'toolResult') {
    const content = (message as any).content;
    if (typeof content === 'string' && content.includes('tool_call_id is not found')) {
      return 'Contains invalid tool_call_id reference';
    }
  }

  return null;
}

/**
 * Quick check if messages contain any problematic entries.
 * Useful for debugging and monitoring.
 */
export function hasProblematicMessages(messages: AgentMessage[]): boolean {
  return messages.some((m) => isProblematicMessage(m));
}
