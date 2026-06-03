// Block-level renderers used by MessageBubble. Splits the bubble's main column
// into either text/image nodes or a collapsible AssistantStepsBlock for runs
// of consecutive thinking/tool_use blocks.

import { type ReactNode } from 'react';

import { MarkdownView } from '@/features/chat/markdown/markdown-view';
import { AssistantStepsBlock } from '@/features/chat/messages/assistant-steps-block';
import type {
  ImageContent,
  MessageContent,
  ThinkingContent,
  ToolUseContent,
} from '@/features/chat/messages/messages.types';
import type {
  StepsClusterDoneLabels,
  StepsClusterIngLabels,
  StepsClusterJoinLabels,
} from '@/features/chat/messages/tool-action-cluster';
import type { ToolCardLabels } from '@/features/chat/tool-results/tool-result-cards';
import { UserMessageSegments } from '@/features/chat/messages/user-message-segments';
import { stripEnvelopeTimestampPrefix } from '@/features/chat/messages/user-message-plain-text';
import { stripStartupContextForDisplay } from '@/features/chat/messages/wire-text-scrub';
import { WorkflowCard, type WorkflowCardLabels } from '@/features/chat/workflow/workflow-card';
import { defaultWorkflowCardLabels } from '@/features/chat/workflow/workflow-card-labels';
import { isWorkflowToolBlock } from '@/features/chat/workflow/workflow.utils';
import { cn } from '@/lib/cn';
import { interaction } from '@/lib/interaction';

function renderTextOrImageBlock(
  block: MessageContent,
  key: string,
  isUser: boolean,
  imagePreviewLabel: string,
  onImagePreview?: (block: ImageContent, index: number) => void,
  contentIndex?: number,
) {
  if (block.type === 'text') {
    if (isUser) {
      const displayText = stripEnvelopeTimestampPrefix(
        stripStartupContextForDisplay(block.text ?? ''),
      );
      return (
        <div key={key} className="min-w-0">
          <UserMessageSegments text={displayText} />
        </div>
      );
    }
    return (
      <div key={key} className="markdown-content min-w-0">
        <MarkdownView content={block.text} compact />
      </div>
    );
  }
  if (block.type === 'image' && block.source?.data) {
    const idx = contentIndex ?? 0;
    if (onImagePreview) {
      return (
        <button
          key={key}
          type="button"
          className={cn(
            'inline-block max-w-full rounded-lg p-0 text-left',
            interaction.press,
            interaction.focusRingPanel,
            'cursor-pointer',
          )}
          onClick={() => onImagePreview(block, idx)}
          title={imagePreviewLabel}
          aria-label={imagePreviewLabel}
        >
          <img
            src={block.source.data}
            className="max-h-96 max-w-full rounded-lg align-top"
            alt=""
          />
        </button>
      );
    }
    return (
      <img key={key} src={block.source.data} className="max-h-96 max-w-full rounded-lg" alt="" />
    );
  }
  return null;
}

/** True once assistant text exists after this index (first answer token closes the steps drawer). */
function hasAssistantTextAfter(content: MessageContent[], indexAfterSteps: number): boolean {
  for (let j = indexAfterSteps; j < content.length; j++) {
    const b = content[j];
    if (b.type === 'text' && (b.text ?? '').length > 0) {
      return true;
    }
  }
  return false;
}

export function renderChunkedContent(
  content: MessageContent[],
  isUser: boolean,
  isAssistantMessageStreaming: boolean,
  toolLabels: { input: string; output: string; noOutput: string },
  stepLabels: {
    thoughts: string;
    thoughtsStreaming: string;
    viewSteps_one: string;
    viewSteps_other: string;
    searchedWeb: string;
    readFile: string;
    stepDetails: string;
    runCommand: string;
    listDirectory: string;
    writeFile: string;
    editFile: string;
    openUrl: string;
    fetchUrl: string;
    unknownTool: string;
  },
  clusterLabels: {
    done: StepsClusterDoneLabels;
    ing: StepsClusterIngLabels;
    join: StepsClusterJoinLabels;
  },
  cardLabels: ToolCardLabels,
  imagePreviewLabel: string,
  onImagePreview: ((block: ImageContent, index: number) => void) | undefined,
  sessionKey: string | null | undefined,
  workflowOptions?: WorkflowRenderOptions,
) {
  const nodes: ReactNode[] = [];
  const wfOpts = workflowOptions ?? {};
  const wfLabels = wfOpts.labels ?? defaultWorkflowCardLabels();
  let i = 0;
  let imageOrdinal = 0;
  while (i < content.length) {
    const b = content[i];

    // Workflow tool_use is rendered as its own block (independent card) and
    // breaks the surrounding steps run so the steps drawer above/below stays
    // accurate without it.
    if (b.type === 'tool_use' && isWorkflowToolBlock(b)) {
      nodes.push(
        <WorkflowCard
          key={`workflow-${b.id ?? i}`}
          block={b}
          startedAt={wfOpts.getStartedAt?.(b)}
          onAbort={wfOpts.onAbort}
          onSendChatMessage={wfOpts.onSendChatMessage}
          labels={wfLabels}
        />,
      );
      i++;
      continue;
    }

    if (b.type === 'thinking' || b.type === 'tool_use') {
      const start = i;
      while (i < content.length) {
        const c = content[i];
        if (c.type === 'thinking') {
          i++;
          continue;
        }
        if (c.type === 'tool_use' && !isWorkflowToolBlock(c)) {
          i++;
          continue;
        }
        break;
      }
      const slice = content.slice(start, i) as Array<ThinkingContent | ToolUseContent>;
      if (slice.length > 0) {
        const finalAnswerStarted = !isUser && hasAssistantTextAfter(content, i);
        nodes.push(
          <AssistantStepsBlock
            key={`steps-${start}`}
            blocks={slice}
            toolLabels={toolLabels}
            stepLabels={stepLabels}
            clusterLabels={clusterLabels}
            cardLabels={cardLabels}
            sessionKey={sessionKey}
            isMessageStreaming={!isUser && isAssistantMessageStreaming}
            finalAnswerStarted={finalAnswerStarted}
          />,
        );
      }
    } else {
      const imgIdx = b.type === 'image' ? imageOrdinal++ : 0;
      const el = renderTextOrImageBlock(
        b,
        `block-${i}`,
        isUser,
        imagePreviewLabel,
        onImagePreview,
        b.type === 'image' ? imgIdx : i,
      );
      if (el) nodes.push(el);
      i++;
    }
  }
  return nodes;
}

/**
 * Optional plumbing for WorkflowCard. All fields optional — when absent the
 * card renders with default English labels, hides the cancel button (running
 * → no abort), and hides the "Save as…" entry (no chat-send channel).
 */
export interface WorkflowRenderOptions {
  labels?: WorkflowCardLabels;
  onAbort?: () => void;
  onSendChatMessage?: (text: string) => void;
  /**
   * Resolve a "running since" timestamp for the live elapsed-time ticker.
   * Defaults to `undefined` (no elapsed time shown until the snapshot
   * provides durationMs at completion).
   */
  getStartedAt?: (block: ToolUseContent) => number | undefined;
}
