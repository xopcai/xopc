import type { Message, MessageContent, ProgressState } from '@/features/chat/messages.types';
import { resolveDataUrlForDisplay } from '@/features/chat/attachment-utils';
import { MarkdownView } from '@/features/chat/markdown/markdown-view';
import { ThinkingBlock } from '@/features/chat/thinking-block';
import { ToolCallCard } from '@/features/chat/tool-call-card';
import { stringToToolResultMessage } from '@/features/chat/tool-result';
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

function renderBlock(
  block: MessageContent,
  key: string,
  toolLabels: { input: string; output: string; noOutput: string },
  thinkingLabels: { thoughts: string; thoughtsStreaming: string; thoughtsExpandHint: string },
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
  if (block.type === 'thinking') {
    return (
      <ThinkingBlock
        key={key}
        content={block.text || ''}
        isStreaming={Boolean(block.streaming)}
        labels={thinkingLabels}
      />
    );
  }
  if (block.type === 'tool_use') {
    const isStreaming = block.status === 'running';
    const resultMsg = !isStreaming ? stringToToolResultMessage(block.result, block.status === 'error') : undefined;
    const resultText = resultMsg?.content
      .filter((c) => c.type === 'text')
      .map((c) => c.text ?? '')
      .join('\n');
    return (
      <ToolCallCard
        key={key}
        toolName={block.name}
        params={block.input}
        resultText={resultText}
        isStreaming={isStreaming}
        isError={block.status === 'error'}
        labels={toolLabels}
      />
    );
  }
  return null;
}

function UserAttachments({
  attachments,
}: {
  attachments: NonNullable<Message['attachments']>;
}) {
  const images = attachments.filter((a) => a.type === 'image' || a.mimeType?.startsWith('image/'));
  const docs = attachments.filter((a) => a.type !== 'image' && !a.mimeType?.startsWith('image/'));

  return (
    <div className="mt-2 flex flex-col gap-2">
      {images.length > 0 ? (
        <div
          className={cn(
            'grid gap-2',
            images.length === 1 && 'grid-cols-1',
            images.length === 2 && 'grid-cols-2',
            images.length >= 3 && 'grid-cols-2 sm:grid-cols-3',
          )}
        >
          {images.map((att, i) => {
            const payload = att.content ?? att.data ?? '';
            const src = resolveDataUrlForDisplay(att.mimeType || 'image/png', payload);
            return (
              <img
                key={att.id ?? i}
                src={src}
                alt={att.name ?? ''}
                className="max-h-48 w-full rounded-md object-cover"
              />
            );
          })}
        </div>
      ) : null}
      {docs.length > 0 ? (
        <ul className="flex flex-wrap gap-1.5">
          {docs.map((d, i) => (
            <li
              key={d.id ?? i}
              className="rounded-md border border-edge bg-surface-hover px-2 py-1 text-[11px] text-fg-muted dark:border-edge"
            >
              {d.name ?? 'file'}
            </li>
          ))}
        </ul>
      ) : null}
    </div>
  );
}

export function MessageBubble({
  message,
  authToken: _authToken,
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
  const thinkingLabels = {
    thoughts: m.chat.thoughts,
    thoughtsStreaming: m.chat.thoughtsStreaming,
    thoughtsExpandHint: m.chat.thoughtsExpandHint,
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
          isUser ? 'bg-accent' : isAssistant ? 'bg-fg-muted' : 'bg-fg-disabled',
        )}
        aria-hidden
      >
        {avatarLetter}
      </div>
      <div className="flex min-w-0 max-w-[85%] flex-col gap-1">
        <div className="flex flex-wrap items-center gap-2 text-xs text-fg-muted">
          <span className="font-medium text-fg">{roleLabel}</span>
          <span className="text-fg-disabled">·</span>
          <span>{formatTime(message.timestamp)}</span>
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
            'rounded-2xl border border-transparent px-3 py-2 text-sm',
            isUser ? 'bg-accent/15 text-fg' : 'bg-surface-hover text-fg',
          )}
        >
          {message.content?.length ? (
            <div className="flex flex-col gap-2">
              {message.content.map((block, j) => renderBlock(block, `${j}`, toolLabels, thinkingLabels))}
              {isStreaming ? <span className="inline-block h-3 w-0.5 animate-pulse bg-accent align-middle" /> : null}
            </div>
          ) : isStreaming ? (
            <span className="inline-block h-3 w-0.5 animate-pulse bg-accent" />
          ) : null}

          {legacyThinking ? (
            <ThinkingBlock
              content={message.thinking || ''}
              isStreaming={Boolean(message.thinkingStreaming)}
              labels={{
                thoughts: m.chat.thoughts,
                thoughtsStreaming: m.chat.thoughtsStreaming,
                thoughtsExpandHint: m.chat.thoughtsExpandHint,
              }}
            />
          ) : null}

          {message.attachments?.length ? <UserAttachments attachments={message.attachments} /> : null}
        </div>

        {isAssistant && message.usage ? <UsageBadge usage={message.usage} /> : null}
      </div>
    </div>
  );
}
