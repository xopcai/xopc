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
import { UserMessageSegments } from '@/features/chat/messages/user-message-segments';
import { stripEnvelopeTimestampPrefix } from '@/features/chat/messages/user-message-plain-text';
import { cn } from '@/lib/cn';
import { interaction } from '@/lib/interaction';

export function renderTextOrImageBlock(
  block: MessageContent,
  key: string,
  isUser: boolean,
  imagePreviewLabel: string,
  onImagePreview?: (block: ImageContent, index: number) => void,
  contentIndex?: number,
) {
  if (block.type === 'text') {
    if (isUser) {
      const displayText = stripEnvelopeTimestampPrefix(block.text ?? '');
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
  imagePreviewLabel: string,
  onImagePreview: ((block: ImageContent, index: number) => void) | undefined,
  sessionKey: string | null | undefined,
) {
  const nodes: ReactNode[] = [];
  let i = 0;
  let imageOrdinal = 0;
  while (i < content.length) {
    const b = content[i];
    if (b.type === 'thinking' || b.type === 'tool_use') {
      const start = i;
      while (i < content.length && (content[i].type === 'thinking' || content[i].type === 'tool_use')) {
        i++;
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
