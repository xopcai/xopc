import type { ReactNode } from 'react';
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

function progressEmoji(stage: string): string {
  const map: Record<string, string> = {
    thinking: '🤔',
    searching: '🔍',
    reading: '📖',
    writing: '✍️',
    executing: '⚙️',
    analyzing: '📊',
    idle: '💬',
  };
  return map[stage] || '💬';
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

export function MessageBubble({
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
  const avatarLetter = roleLabel.charAt(0);

  const toolLabels = { input: m.chat.toolInput, output: m.chat.toolOutput, noOutput: m.chat.noOutput };
  const stepLabels = {
    thoughts: m.chat.thoughts,
    thoughtsStreaming: m.chat.thoughtsStreaming,
    viewSteps_one: m.chat.viewSteps_one,
    viewSteps_other: m.chat.viewSteps_other,
    searchedWeb: m.chat.stepSearchedWeb,
    readFile: m.chat.stepReadFile,
    stepDetails: m.chat.stepDetails,
  };

  const streamingThinking =
    message.thinkingStreaming ||
    message.content?.some((b) => b.type === 'thinking' && b.streaming);

  const legacyThinking =
    !message.content.some((b) => b.type === 'thinking') && (message.thinking || message.thinkingStreaming);

  return (
    <div className={cn('flex gap-3', isUser && 'flex-row-reverse')}>
      <div
        className={cn(
          'flex h-8 w-8 shrink-0 items-center justify-center rounded-full text-xs font-semibold text-white',
          isUser ? 'bg-accent dark:bg-accent' : isAssistant ? 'bg-neutral-600 dark:bg-neutral-500' : 'bg-neutral-400',
        )}
        aria-hidden
      >
        {avatarLetter}
      </div>
      <div className="flex min-w-0 max-w-[min(85%,42rem)] flex-col gap-1.5">
        <div className="flex flex-wrap items-center gap-2 text-xs text-fg-subtle">
          <span className="font-medium text-fg">{roleLabel}</span>
          <span className="text-fg-disabled">·</span>
          <span className="tabular-nums">{formatTime(message.timestamp)}</span>
          {progress ? (
            <span className="animate-pulse text-accent-fg" title={progress.detail ?? ''}>
              {progressEmoji(progress.stage)} {progress.message}
            </span>
          ) : null}
          {isStreaming && !streamingThinking ? (
            <span className="animate-pulse text-accent-fg">{m.chat.thinkingLabel}</span>
          ) : null}
        </div>

        <div
          className={cn(
            'min-w-0 rounded-2xl border px-4 py-3 text-sm leading-relaxed',
            isUser
              ? 'border-accent-soft bg-accent-soft/40 text-fg dark:border-accent-soft dark:bg-accent-soft/30'
              : 'border-edge-subtle bg-surface-panel text-fg shadow-sm shadow-slate-200/30 dark:border-edge dark:bg-surface-panel/70 dark:shadow-none',
          )}
        >
          <div className="flex min-w-0 flex-col gap-2">
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
              <AttachmentRenderer attachments={message.attachments} authToken={authToken} />
            ) : null}
          </div>
        </div>

        {isAssistant && message.usage ? <UsageBadge usage={message.usage} /> : null}
      </div>
    </div>
  );
}
