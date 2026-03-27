import { type ReactNode, memo, useMemo } from 'react';
import type {
  Message,
  MessageContent,
  ProgressState,
  ThinkingContent,
  ToolUseContent,
} from '@/features/chat/messages.types';
import { AssistantStepsBlock } from '@/features/chat/assistant-steps-block';
import { AttachmentRenderer } from '@/features/chat/attachment-renderer';
import { MarkdownView } from '@/features/chat/markdown/markdown-view';
import { UsageBadge } from '@/features/chat/usage-badge';
import { cn } from '@/lib/cn';
import { messages } from '@/i18n/messages';
import { useLocaleStore } from '@/stores/locale-store';

function formatTime(ts?: number): string {
  if (!ts) return '';
  return new Date(ts).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
}

function renderTextOrImageBlock(
  block: MessageContent,
  key: string,
) {
  if (block.type === 'text') {
    return (
      <div key={key} className="markdown-content min-w-0">
        <MarkdownView content={block.text} />
      </div>
    );
  }
  if (block.type === 'image' && block.source?.data) {
    return (
      <img key={key} src={block.source.data} className="max-h-96 max-w-full rounded-lg" alt="" />
    );
  }
  return null;
}

function renderChunkedContent(
  content: MessageContent[],
  toolLabels: { input: string; output: string; noOutput: string },
  stepLabels: {
    thoughts: string;
    thoughtsStreaming: string;
    viewSteps_one: string;
    viewSteps_other: string;
    searchedWeb: string;
    readFile: string;
    stepDetails: string;
  },
) {
  const nodes: ReactNode[] = [];
  let i = 0;
  while (i < content.length) {
    const b = content[i];
    if (b.type === 'thinking' || b.type === 'tool_use') {
      const start = i;
      while (i < content.length && (content[i].type === 'thinking' || content[i].type === 'tool_use')) {
        i++;
      }
      const slice = content.slice(start, i) as Array<ThinkingContent | ToolUseContent>;
      nodes.push(
        <AssistantStepsBlock
          key={`steps-${start}`}
          blocks={slice}
          toolLabels={toolLabels}
          stepLabels={stepLabels}
        />,
      );
    } else {
      const el = renderTextOrImageBlock(b, `block-${i}`);
      if (el) nodes.push(el);
      i++;
    }
  }
  return nodes;
}

export const MessageBubble = memo(function MessageBubble({
  message,
  authToken,
  isStreaming,
  progress,
}: {
  message: Message;
  authToken?: string;
  isStreaming: boolean;
  progress: ProgressState | null;
}) {
  const language = useLocaleStore((s) => s.language);
  const m = messages(language);

  const isUser = message.role === 'user' || message.role === 'user-with-attachments';
  const isAssistant = message.role === 'assistant';
  const roleLabel = isUser ? m.chat.you : isAssistant ? m.chat.assistant : m.chat.tool;

  const toolLabels = useMemo(
    () => ({ input: m.chat.toolInput, output: m.chat.toolOutput, noOutput: m.chat.noOutput }),
    [language, m.chat.toolInput, m.chat.toolOutput, m.chat.noOutput],
  );
  const stepLabels = useMemo(
    () => ({
      thoughts: m.chat.thoughts,
      thoughtsStreaming: m.chat.thoughtsStreaming,
      viewSteps_one: m.chat.viewSteps_one,
      viewSteps_other: m.chat.viewSteps_other,
      searchedWeb: m.chat.stepSearchedWeb,
      readFile: m.chat.stepReadFile,
      stepDetails: m.chat.stepDetails,
    }),
    [
      language,
      m.chat.thoughts,
      m.chat.thoughtsStreaming,
      m.chat.viewSteps_one,
      m.chat.viewSteps_other,
      m.chat.stepSearchedWeb,
      m.chat.stepReadFile,
      m.chat.stepDetails,
    ],
  );

  const streamingThinking =
    message.thinkingStreaming ||
    message.content?.some((b) => b.type === 'thinking' && b.streaming);

  const legacyThinking =
    !message.content.some((b) => b.type === 'thinking') && (message.thinking || message.thinkingStreaming);

  const showMeta =
    Boolean(message.timestamp) ||
    Boolean(progress?.message) ||
    (isStreaming && !streamingThinking);

  return (
    <article className={cn('flex w-full min-w-0', isUser ? 'justify-end' : 'justify-start')}>
      <div
        className={cn(
          'min-w-0 max-w-[min(85%,42rem)]',
          isUser ? 'w-max' : 'w-full',
        )}
      >
        <span className="sr-only">{roleLabel}</span>

        {showMeta ? (
          <div
            className={cn(
              'mb-2 flex flex-wrap items-baseline gap-x-2 gap-y-0.5 text-xs text-fg-disabled',
              isUser && 'justify-end',
            )}
          >
            {message.timestamp ? (
              <time className="tabular-nums" dateTime={new Date(message.timestamp).toISOString()}>
                {formatTime(message.timestamp)}
              </time>
            ) : null}
            {progress?.message ? (
              <span className="text-fg-subtle" title={progress.detail ?? ''}>
                {progress.message}
              </span>
            ) : null}
            {isStreaming && !streamingThinking ? (
              <span className="text-fg-subtle">{m.chat.thinkingLabel}</span>
            ) : null}
          </div>
        ) : null}

        <div
          className={cn(
            'min-w-0 text-sm leading-relaxed text-fg',
            isUser &&
              'rounded-xl bg-accent-soft/55 px-4 py-3 text-right dark:bg-accent-soft/35',
            isUser && message.attachments?.length
              ? 'min-w-[min(16rem,90vw)] max-w-[min(85%,42rem)]'
              : '',
          )}
        >
          <div
            className={cn(
              'flex min-w-0 flex-col gap-2',
              isUser && message.attachments?.length ? 'items-end' : '',
            )}
          >
            {message.content?.length ? (
              <>
                {renderChunkedContent(message.content, toolLabels, stepLabels)}
                {isStreaming ? (
                  <span className="inline-block h-3 w-0.5 animate-pulse bg-accent align-middle" />
                ) : null}
              </>
            ) : isStreaming ? (
              <span className="inline-block h-3 w-0.5 animate-pulse bg-accent" />
            ) : null}

            {legacyThinking ? (
              <AssistantStepsBlock
                blocks={[
                  {
                    type: 'thinking',
                    text: message.thinking || '',
                    streaming: Boolean(message.thinkingStreaming),
                  },
                ]}
                toolLabels={toolLabels}
                stepLabels={stepLabels}
              />
            ) : null}

            {message.attachments?.length ? (
              <AttachmentRenderer
                attachments={message.attachments}
                authToken={authToken}
                layout={isUser ? 'user' : 'assistant'}
              />
            ) : null}
          </div>
        </div>

        {isAssistant && message.usage ? (
          <div className="mt-3">
            <UsageBadge usage={message.usage} />
          </div>
        ) : null}
      </div>
    </article>
  );
});
