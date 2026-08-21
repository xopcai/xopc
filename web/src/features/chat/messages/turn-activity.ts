import type {
  MessageContent,
  ThinkingContent,
  ToolUseContent,
} from '@/features/chat/messages/messages.types';

export type TurnActivityBlock = ThinkingContent | ToolUseContent;

export function collectTurnActivityBlocks(content: MessageContent[]): TurnActivityBlock[] {
  return content.filter(
    (block): block is TurnActivityBlock =>
      block.type === 'thinking' || block.type === 'tool_use',
  );
}

export function hasAssistantAnswerText(content: MessageContent[]): boolean {
  return content.some(
    (block) =>
      block.type === 'text'
      && block.presentation !== 'pending'
      && block.presentation !== 'narration'
      && Boolean(block.text?.trim()),
  );
}
