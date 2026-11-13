import type { Message, ToolUseContent } from '@/features/chat/messages/messages.types';
import { parseToolResult } from '@/features/chat/tool-results/parse-tool-result';

function generationId(block: ToolUseContent): string | undefined {
  const { details, text } = parseToolResult(block.result);
  if (typeof details?.id === 'string') return details.id;
  const storedDetails = block.details as { id?: unknown } | undefined;
  if (typeof storedDetails?.id === 'string') return storedDetails.id;
  if (text.trimStart().startsWith('{')) {
    try {
      const receipt = JSON.parse(text);
      if (typeof receipt?.id === 'string') return receipt.id;
    } catch {
      // A stored tool result may be truncated.
    }
  }
}

export function findMediaGenerationReplyIndexes(messages: readonly Message[], toolName: 'music_generation' | 'video_draft') {
  const indexes = new Map<string, number>();
  messages.forEach((message, index) => {
    if (message.role !== 'assistant') return;
    for (const block of message.content) {
      if (block.type !== 'tool_use' || block.name !== toolName || block.status === 'error') continue;
      const id = generationId(block);
      // Video draft updates reuse the ID and move the card to the reply that updated it.
      if (id && (toolName === 'video_draft' || !indexes.has(id))) indexes.set(id, index);
    }
  });
  return indexes;
}
