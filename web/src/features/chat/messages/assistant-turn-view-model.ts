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
  TextContent,
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
import { extractProductDelivery } from '@/features/chat/product-delivery/product-delivery';
import type { ProductDeliveryEnvelope } from '@xopcai/gateway-contract';

export type AssistantTurnLifecycleState =
  | 'starting'
  | 'reasoning'
  | 'using_tool'
  | 'answering'
  | 'completed'
  | 'partial';

export interface AssistantTurnViewModel {
  answerContent: MessageContent[];
  workLog: AssistantTurnWorkLogPresentation;
  answer: {
    started: boolean;
    showStreamingCursor: boolean;
  };
  lifecycle: {
    state: AssistantTurnLifecycleState;
    activeTool?: ToolUseContent;
  };
  outcome: Message['outcome'];
  delivery: ProductDeliveryEnvelope | null;
  attachments?: MessageAttachment[];
  sources: SearchSource[];
}

export type AssistantWorkLogItem = TextContent | ThinkingContent | ToolUseContent;

export interface AssistantTurnWorkLogPresentation {
  items: AssistantWorkLogItem[];
  active: boolean;
  status: 'running' | 'completed' | 'partial' | 'failed';
  expandedByDefault: boolean;
  startedAt?: number;
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
  const answerContent = (message.content ?? []).filter((block) => (
    block.type === 'review'
    || (block.type === 'text'
      && block.presentation !== 'pending'
      && block.presentation !== 'narration')
  ));
  const allActivityBlocks = filterVisibleSteps(collectTurnActivityBlocks(message.content ?? []));
  const workLogItems = (message.content ?? []).filter(
    (block): block is AssistantWorkLogItem => {
      if (block.type === 'tool_use') return true;
      if (reasoningLevel === 'off') return false;
      if (block.type === 'thinking') return Boolean(block.text?.trim()) || Boolean(block.streaming);
      return block.type === 'text'
        && (block.presentation === 'pending' || block.presentation === 'narration')
        && Boolean(block.text?.trim());
    },
  );
  const answerStarted = hasAssistantAnswerText(answerContent);
  const toolBlocks = allActivityBlocks.filter(
    (block): block is ToolUseContent => block.type === 'tool_use',
  );
  const runningTool = [...toolBlocks].reverse().find(
    (tool) => tool.status === 'running' || tool.activity?.status === 'running',
  );
  const delivery = [...toolBlocks]
    .reverse()
    .map(extractProductDelivery)
    .find((candidate) => candidate !== null
      && candidate.primary?.kind !== 'workflow_run'
      && candidate.primary?.kind !== 'file'
      && (candidate.primary?.kind !== 'note'
        || candidate.operation === 'created'
        || candidate.operation === 'updated')) ?? null;
  const activityEndedAt = !isStreaming
    ? message.completedAt ?? message.timestamp
    : undefined;
  const timing = getActivityTiming(allActivityBlocks, activityEndedAt);
  const startedAtCandidates = [message.timestamp, timing.startedAt]
    .filter((value): value is number => Number.isFinite(value));
  const workLogStartedAt = startedAtCandidates.length > 0
    ? Math.min(...startedAtCandidates)
    : undefined;
  const workLogDurationMs = workLogStartedAt != null && timing.completedAt != null
    ? Math.max(0, timing.completedAt - workLogStartedAt)
    : undefined;
  const workLogStatus = isStreaming
    ? 'running'
    : message.outcome?.status === 'failed'
      ? 'failed'
      : message.outcome?.status === 'partial'
        ? 'partial'
        : 'completed';
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
    state = message.outcome?.status === 'partial' || message.outcome?.status === 'failed'
      ? 'partial'
      : 'completed';
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
    answerContent,
    workLog: {
      items: workLogItems,
      active: isStreaming && workLogItems.length > 0,
      status: workLogStatus,
      expandedByDefault:
        reasoningLevel === 'stream' && isStreaming && !answerStarted,
      startedAt: workLogStartedAt,
      durationMs: workLogDurationMs,
    },
    answer: {
      started: answerStarted,
      showStreamingCursor:
        isStreaming &&
        (workLogItems.length === 0 || state === 'answering'),
    },
    lifecycle: {
      state,
      activeTool: state === 'using_tool' ? runningTool : undefined,
    },
    outcome: message.outcome,
    delivery,
    attachments: standaloneAttachments,
    sources: extractSearchSources(toolBlocks),
  };
}
