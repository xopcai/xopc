import {
  collectAssistantWorkspaceOutputPaths,
  filterAssistantAttachmentsDedupedAgainstWorkspacePaths,
  imageContentBlocksToAttachments,
} from '@/features/chat/messages/assistant-message-artifacts';
import { getActivityTiming } from '@/features/chat/messages/activity-timing';
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
} from '@/features/chat/tool-results/search-source-list';

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
  activityBlocks: Array<ThinkingContent | ToolUseContent>;
  answerStarted: boolean;
  lifecycle: {
    state: AssistantTurnLifecycleState;
    activeTool?: ToolUseContent;
    failedToolCount: number;
    startedAt?: number;
    completedAt?: number;
    durationMs?: number;
  };
  deliverables: {
    workspacePaths: ReturnType<typeof collectAssistantWorkspaceOutputPaths>;
    imageAttachments: MessageAttachment[];
    attachments?: MessageAttachment[];
  };
  sources: SearchSource[];
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
  const displayContent =
    reasoningLevel === 'off'
      ? (message.content ?? []).filter((block) => block.type !== 'thinking')
      : (message.content ?? []);
  const flowContent = displayContent.filter((block) => block.type !== 'image');
  const activityBlocks = collectTurnActivityBlocks(displayContent);
  const answerStarted = hasAssistantAnswerText(flowContent);
  const toolBlocks = activityBlocks.filter(
    (block): block is ToolUseContent => block.type === 'tool_use',
  );
  const activeTool = [...toolBlocks].reverse().find((tool) => tool.status === 'running');
  const failedToolCount = toolBlocks.filter((tool) => tool.status === 'error').length;
  const timing = getActivityTiming(activityBlocks);
  const imageBlocks = (message.content ?? []).filter(
    (block): block is ImageContent =>
      block.type === 'image' && Boolean(block.source?.data),
  );
  const workspacePaths = collectAssistantWorkspaceOutputPaths(message.content);

  let state: AssistantTurnLifecycleState;
  if (!isStreaming) {
    state = failedToolCount > 0 ? 'partial' : 'completed';
  } else if (activeTool) {
    state = 'using_tool';
  } else if (
    activityBlocks.some(
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
    activityBlocks,
    answerStarted,
    lifecycle: {
      state,
      activeTool,
      failedToolCount,
      ...timing,
    },
    deliverables: {
      workspacePaths,
      imageAttachments: imageContentBlocksToAttachments(imageBlocks),
      attachments: filterAssistantAttachmentsDedupedAgainstWorkspacePaths(
        message.attachments,
        workspacePaths,
      ),
    },
    sources: extractSearchSources(toolBlocks),
  };
}
