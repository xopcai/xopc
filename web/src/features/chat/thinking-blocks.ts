import type { Message, ThinkingContent, ToolUseContent } from '@/features/chat/messages.types';

export function messageRowKey(msg: Message, index: number): string {
  return `${msg.timestamp ?? 'n'}-${index}`;
}

/** Consecutive `thinking` / `tool_use` blocks starting at `groupStart`, or legacy thinking when `groupStart === -1`. */
export function getStepGroupBlocks(
  message: Message,
  groupStart: number,
): Array<ThinkingContent | ToolUseContent> {
  if (groupStart === -1) {
    if (message.thinking || message.thinkingStreaming) {
      return [
        {
          type: 'thinking',
          text: message.thinking || '',
          streaming: Boolean(message.thinkingStreaming),
        },
      ];
    }
    return [];
  }
  const content = message.content ?? [];
  const b = content[groupStart];
  if (!b || (b.type !== 'thinking' && b.type !== 'tool_use')) return [];
  let end = groupStart;
  while (
    end < content.length &&
    (content[end].type === 'thinking' || content[end].type === 'tool_use')
  ) {
    end++;
  }
  return content.slice(groupStart, end) as Array<ThinkingContent | ToolUseContent>;
}
