import type { MessageContent, TextContent } from './messages.types';

/** Project the last model response after execution, without changing stored transcripts. */
export function assistantAnswerContent(content: MessageContent[], options?: { includePending?: boolean }): MessageContent[] {
  let lastActivity = -1;
  let lastText: TextContent | undefined;
  for (let index = 0; index < content.length; index++) {
    const block = content[index];
    if (block.type === 'tool_use' || block.type === 'thinking') lastActivity = index;
    if (block.type === 'text' && block.text.trim()) lastText = block;
  }
  return content.filter((block, index) => block.type === 'review' || (
    block.type === 'text'
    && index > lastActivity
    && (options?.includePending || block.presentation !== 'pending')
    && block.presentation !== 'narration'
    && (!lastText?.segmentId || !block.segmentId || block.segmentId === lastText.segmentId)
  ));
}
