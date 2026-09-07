import { resolveStepBlocksForRender } from './assistant-steps-summary';
import { collectAssistantDeliverables } from './assistant-deliverables';
import type {
  Message,
  MessageContent,
  ReasoningLevel,
  ThinkingContent,
  ToolUseContent,
} from './messages.types';

export type AssistantActivityPresentation = {
  blocks: Array<ThinkingContent | ToolUseContent>;
  active: boolean;
  expandedByDefault: boolean;
};

function hasAssistantAnswerText(content: MessageContent[]): boolean {
  return content.some(
    (block) =>
      block.type === 'text'
      && block.presentation !== 'narration'
      && Boolean(block.text.trim()),
  );
}

/** Mobile projection of the WebUI assistant turn presentation rules. */
export function buildAssistantTurnViewModel({
  message,
  isStreaming,
  reasoningLevel,
}: {
  message: Message;
  isStreaming: boolean;
  reasoningLevel: ReasoningLevel;
}): {
  displayContent: MessageContent[];
  activity: AssistantActivityPresentation;
  answerStarted: boolean;
  showStreamingCursor: boolean;
  deliverables: ReturnType<typeof collectAssistantDeliverables>;
} {
  const content = message.content;
  const displayContent = reasoningLevel === 'off'
    ? content.filter((block) => block.type !== 'thinking')
    : content;
  const allActivity = resolveStepBlocksForRender(
    content.filter(
      (block): block is ThinkingContent | ToolUseContent =>
        block.type === 'thinking' || block.type === 'tool_use',
    ),
    isStreaming,
  );
  const activityBlocks = reasoningLevel === 'off'
    ? allActivity.filter((block): block is ToolUseContent => block.type === 'tool_use')
    : allActivity;
  const answerStarted = hasAssistantAnswerText(displayContent);
  const active = isStreaming && allActivity.some(
    (block) =>
      (block.type === 'thinking' && Boolean(block.streaming))
      || (block.type === 'tool_use' && block.status === 'running'),
  );

  return {
    displayContent,
    activity: {
      blocks: activityBlocks,
      active,
      expandedByDefault: reasoningLevel === 'stream' && isStreaming && !answerStarted,
    },
    answerStarted,
    showStreamingCursor: isStreaming && (activityBlocks.length === 0 || answerStarted),
    deliverables: collectAssistantDeliverables(message, isStreaming),
  };
}
