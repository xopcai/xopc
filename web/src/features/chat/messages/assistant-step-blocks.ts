import type { Message, ThinkingContent, ToolUseContent } from '@/features/chat/messages/messages.types';

/** All thinking + tool_use blocks from the message, in order (for the execution drawer). */
export function collectAssistantStepBlocks(message: Message): Array<ThinkingContent | ToolUseContent> {
  const out: Array<ThinkingContent | ToolUseContent> = [];
  for (const b of message.content ?? []) {
    if (b.type === 'thinking' || b.type === 'tool_use') {
      out.push(b);
    }
  }
  if (out.length > 0) return out;
  return [];
}
