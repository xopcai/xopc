import {
  collectAssistantWorkspaceOutputPaths,
  collectAssistantToolMedia,
  filterAssistantAttachmentsDedupedAgainstWorkspacePaths,
  imageContentBlocksToAttachments,
} from '@/features/chat/messages/assistant-message-artifacts';
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
  activity: AssistantTurnActivityPresentation;
  answer: {
    started: boolean;
    showStreamingCursor: boolean;
  };
  lifecycle: {
    state: AssistantTurnLifecycleState;
    activeTool?: ToolUseContent;
  };
  deliverables: {
    workspacePaths: ReturnType<typeof collectAssistantWorkspaceOutputPaths>;
    mediaAttachments: MessageAttachment[];
    attachments?: MessageAttachment[];
  };
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
  const displayContent =
    reasoningLevel === 'off'
      ? (message.content ?? []).filter((block) => block.type !== 'thinking')
      : (message.content ?? []);
  const flowContent = displayContent.filter((block) => block.type !== 'image');
  const activityBlocks = filterVisibleSteps(collectTurnActivityBlocks(displayContent));
  const answerStarted = hasAssistantAnswerText(flowContent);
  const toolBlocks = activityBlocks.filter(
    (block): block is ToolUseContent => block.type === 'tool_use',
  );
  const runningTool = [...toolBlocks].reverse().find((tool) => tool.status === 'running');
  const failedToolCount = toolBlocks.filter((tool) => tool.status === 'error').length;
  const timing = getActivityTiming(activityBlocks);
  const activityActive =
    isStreaming &&
    activityBlocks.some(
      (block) =>
        (block.type === 'thinking' && Boolean(block.streaming)) ||
        (block.type === 'tool_use' && block.status === 'running'),
    );
  const imageBlocks = (message.content ?? []).filter(
    (block): block is ImageContent =>
      block.type === 'image' && Boolean(block.source?.data),
  );
  const workspacePaths = collectAssistantWorkspaceOutputPaths(message.content);

  let state: AssistantTurnLifecycleState;
  if (!isStreaming) {
    state = failedToolCount > 0 ? 'partial' : 'completed';
  } else if (runningTool) {
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
    deliverables: {
      workspacePaths,
      mediaAttachments: [
        ...imageContentBlocksToAttachments(imageBlocks),
        ...collectAssistantToolMedia(message.content),
      ],
      attachments: filterAssistantAttachmentsDedupedAgainstWorkspacePaths(
        message.attachments,
        workspacePaths,
      ),
    },
    sources: extractSearchSources(toolBlocks),
  };
}
