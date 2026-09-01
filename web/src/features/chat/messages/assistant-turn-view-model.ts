import {
  imageContentBlocksToAttachments,
} from '@/features/chat/messages/assistant-message-images';
import { getActivityTiming } from '@/features/chat/messages/activity-timing';
import { filterVisibleSteps } from '@/features/chat/messages/assistant-steps-summary';
import type {
  ImageContent,
  Message,
  MessageAttachment,
  MessageContent,
  ReasoningLevel,
  ThinkingContent,
  ToolUseContent,
} from '@/features/chat/messages/messages.types';
import {
  collectTurnActivityBlocks,
  hasAssistantAnswerText,
} from '@/features/chat/messages/turn-activity';
import {
  extractSearchSources,
  type SearchSource,
} from '@/features/chat/tool-results/search-source-utils';

export type AssistantTurnLifecycleState =
  | 'starting'
  | 'reasoning'
  | 'using_tool'
  | 'answering'
  | 'completed'
  | 'partial';

export interface AssistantTurnViewModel {
  displayContent: MessageContent[];
  flowContent: MessageContent[];
  activity: AssistantTurnActivityPresentation;
  answer: {
    started: boolean;
    showStreamingCursor: boolean;
  };
  lifecycle: {
    state: AssistantTurnLifecycleState;
    activeTool?: ToolUseContent;
  };
  outcome: Message['outcome'];
  attachments?: MessageAttachment[];
  sources: SearchSource[];
}

export interface AssistantTurnActivityPresentation {
  blocks: Array<ThinkingContent | ToolUseContent>;
  active: boolean;
  failedCount: number;
  hasTool: boolean;
  expandedByDefault: boolean;
  startedAt?: number;
  completedAt?: number;
  durationMs?: number;
}

export function buildAssistantTurnViewModel({
  message,
  isStreaming,
  reasoningLevel,
}: {
  message: Message;
  isStreaming: boolean;
  reasoningLevel: ReasoningLevel;
}): AssistantTurnViewModel {
  const displayContent = (message.content ?? []).filter((block) => {
    if (reasoningLevel !== 'off') return true;
    if (block.type === 'thinking') return false;
    return block.type !== 'text'
      || (block.presentation !== 'pending' && block.presentation !== 'narration');
  });
  const flowContent = displayContent.filter((block) => block.type !== 'image');
  const allActivityBlocks = filterVisibleSteps(collectTurnActivityBlocks(message.content ?? []));
  const activityBlocks = reasoningLevel === 'off'
    ? allActivityBlocks.filter((block): block is ToolUseContent => block.type === 'tool_use')
    : allActivityBlocks;
  const answerStarted = hasAssistantAnswerText(flowContent);
  const toolBlocks = allActivityBlocks.filter(
    (block): block is ToolUseContent => block.type === 'tool_use',
  );
  const runningTool = [...toolBlocks].reverse().find(
    (tool) => tool.status === 'running' || tool.activity?.status === 'running',
  );
  const failedToolCount = toolBlocks.filter(
    (tool) => tool.status === 'error' || tool.activity?.status === 'failed',
  ).length;
  const activityActive = isStreaming && allActivityBlocks.length > 0;
  const activityEndedAt = !isStreaming
    ? message.completedAt ?? message.timestamp
    : undefined;
  const timing = getActivityTiming(allActivityBlocks, activityEndedAt);
  const imageBlocks = (message.content ?? []).filter(
    (block): block is ImageContent =>
      block.type === 'image' && Boolean(block.source?.data),
  );
  const outcomeArtifactIds = new Set(message.outcome?.deliverables.map((item) => item.artifactId));
  const outcomeArtifactUris = new Set(
    message.outcome?.deliverables.flatMap((item) => item.uri ? [item.uri] : []),
  );
  const standaloneAttachments = [
    ...imageContentBlocksToAttachments(imageBlocks),
    ...(message.attachments ?? []),
  ].filter((attachment) => !(
    (attachment.id && outcomeArtifactIds.has(attachment.id))
    || (attachment.uri && outcomeArtifactUris.has(attachment.uri))
  ));

  let state: AssistantTurnLifecycleState;
  if (!isStreaming) {
    state = failedToolCount > 0 ? 'partial' : 'completed';
  } else if (runningTool) {
    state = 'using_tool';
  } else if (
    allActivityBlocks.some(
      (block) => block.type === 'thinking' && Boolean(block.streaming),
    )
  ) {
    state = 'reasoning';
  } else if (answerStarted) {
    state = 'answering';
  } else {
    state = 'starting';
  }

  return {
    displayContent,
    flowContent,
    activity: {
      blocks: activityBlocks,
      active: activityActive,
      failedCount: failedToolCount,
      hasTool: toolBlocks.length > 0,
      expandedByDefault:
        reasoningLevel === 'stream' && isStreaming && !answerStarted,
      ...timing,
    },
    answer: {
      started: answerStarted,
      showStreamingCursor:
        isStreaming &&
        (activityBlocks.length === 0 || state === 'answering'),
    },
    lifecycle: {
      state,
      activeTool: state === 'using_tool' ? runningTool : undefined,
    },
    outcome: message.outcome,
    attachments: standaloneAttachments,
    sources: extractSearchSources(toolBlocks),
  };
}
