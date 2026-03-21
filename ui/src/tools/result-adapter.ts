import type { ToolResultMessage } from './types.js';

/** Build a pi-shaped tool result from gateway/SSE string payloads. */
export function stringToToolResultMessage(text: string | undefined, isError: boolean): ToolResultMessage {
  return {
    content: [{ type: 'text', text: text ?? '' }],
    isError,
  };
}

export function extractTextFromToolResult(result: ToolResultMessage | undefined): string {
  if (!result?.content?.length) return '';
  return result.content
    .filter((c) => c.type === 'text')
    .map((c) => c.text ?? '')
    .join('\n');
}
