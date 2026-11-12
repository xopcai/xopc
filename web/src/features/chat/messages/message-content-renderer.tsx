// Block-level renderers used by MessageBubble for user content and final answers.

import {
  useCallback,
  useEffect,
  useId,
  type ReactNode,
} from 'react';
import { Loader2 } from 'lucide-react';
import type { UserTurnDocument } from '@xopcai/gateway-contract';

import { MarkdownView } from '@/features/chat/markdown/markdown-view';
import { knownPartRenderKey } from '@/features/chat/rendering/part-identity';
import { useChatTextRun } from '@/features/chat/rendering/use-chat-render-state';
import type { WorkspaceFileLinkTarget } from '@/components/markdown/internal-links';
import type {
  ImageContent,
  MessageContextRef,
  MessageContent,
  ReviewContent,
  ThinkingContent,
  ToolUseContent,
} from '@/features/chat/messages/messages.types';
import { UserMessageSegments } from '@/features/chat/messages/user-message-segments';
import { stripUserMessageForDisplay } from '@/features/chat/messages/wire-text-scrub';
import { ProviderSetupRequiredCard } from '@/features/chat/messages/provider-setup-required-banner';
import { parseProviderSetupRequired } from '@/features/chat/messages/provider-setup-required.parser';
import {
  fetchWorkspaceFileBlob,
  resolveWorkspaceFileReference,
} from '@/features/workspace/workspace-api';
import { mergeConsecutiveTextBlocks, textRunSourceIds } from '@/features/chat/messages/streaming-markdown';
import {
  finishStreamingRenderMetrics,
  startStreamingRenderMetrics,
} from '@/components/markdown/streaming-render-metrics';
import { useProgressiveStreamingMarkdown } from '@/features/chat/messages/use-progressive-streaming-markdown';
import { messages } from '@/i18n/messages';
import { cn } from '@/lib/cn';
import { ChatImageThumbnail } from './chat-image-thumbnail';
import { useLocaleStore } from '@/stores/locale-store';
import type { FileReferencePreview } from '@/features/workspace/file-reference-preview';
import { useRightWorkspaceStore } from '@/stores/right-workspace-store';
import { useWorkspacePreviewStore } from '@/stores/workspace-preview-store';

function reviewLocation(finding: ReviewContent['findings'][number]): string {
  if (!finding.filePath) return '';
  if (!finding.lineStart) return finding.filePath;
  const end = finding.lineEnd && finding.lineEnd !== finding.lineStart ? `-${finding.lineEnd}` : '';
  return `${finding.filePath}:${finding.lineStart}${end}`;
}

function ReviewBlock({ review }: { review: ReviewContent }) {
  const language = useLocaleStore(state => state.language);
  const t = messages(language).chat.reviewCard;
  const isRunning = review.status === 'preparing' || review.status === 'reviewing';
  const isPreparing = review.status === 'preparing';
  const modelReviewIncomplete = review.source === 'local' && review.overallCorrectness === 'unknown';
  const correctnessTone =
    review.overallCorrectness === 'patch is incorrect'
      ? 'border-red-500/30 bg-red-500/5 text-red-700 dark:text-red-300'
      : review.overallCorrectness === 'patch is correct'
        ? 'border-emerald-500/30 bg-emerald-500/5 text-emerald-700 dark:text-emerald-300'
        : 'border-edge bg-surface-inset text-fg-secondary';
  return (
    <div className="min-w-0 rounded-lg border border-edge bg-surface-inset p-3">
      <div className="flex flex-wrap items-center gap-2">
        {isRunning ? <Loader2 className="size-4 animate-spin text-accent" aria-hidden /> : null}
        <div className="text-sm font-semibold text-fg-primary">
          {isRunning ? t.running : t.finished}
        </div>
        {isRunning ? (
          <div className="rounded-md border border-edge bg-surface-inset px-1.5 py-0.5 text-[11px] font-medium text-fg-secondary">
            {isPreparing ? t.collecting : t.assistant}
          </div>
        ) : (
          <div className={cn('rounded-md border px-1.5 py-0.5 text-[11px] font-medium', correctnessTone)}>
            {t.correctness[review.overallCorrectness]}
          </div>
        )}
      </div>
      <div className="mt-1 text-xs text-fg-tertiary">{t.basedOn.replace('{{target}}', review.target)}</div>
      {isRunning && !review.analysisMarkdown ? (
        <div className="mt-3 text-sm text-fg-secondary">
          {isPreparing ? t.preparing : t.checking}
        </div>
      ) : null}
      {review.analysisMarkdown ? (
        <div className="mt-3 rounded-md border border-edge-subtle bg-surface px-2.5 py-2">
          <div className="mb-1 text-xs font-medium text-fg-secondary">{t.assistant}</div>
          <MarkdownView content={review.analysisMarkdown} compact streaming={isRunning} />
        </div>
      ) : null}
      {review.status === 'error' && review.errorMessage ? (
        <div className="mt-3 rounded-md border border-warning/30 bg-warning/5 px-2.5 py-2 text-sm text-warning">
          {t.error.replace('{{error}}', review.errorMessage)}
        </div>
      ) : null}
      {!isRunning ? <>
      {review.summary ? (
        <div className="mt-3 text-sm text-fg-secondary">{review.summary}</div>
      ) : null}
      <div className="mt-3 space-y-2">
        {review.findings.length === 0 ? (
          <div className="text-sm text-fg-secondary">
            {modelReviewIncomplete ? t.noModelFindings : t.noFindings}
          </div>
        ) : (
          review.findings.map((finding, index) => {
            const loc = reviewLocation(finding);
            return (
              <div key={`${finding.title}-${index}`} className="rounded-md border border-edge bg-surface p-2">
                <div className="flex flex-wrap items-center gap-2">
                  <span className="rounded border border-edge bg-surface-inset px-1.5 py-0.5 text-[11px] font-semibold text-fg-secondary">
                    P{finding.priority}
                  </span>
                  <span className="min-w-0 text-sm font-medium text-fg-primary">{finding.title}</span>
                </div>
                {loc ? <div className="mt-1 break-all text-xs text-fg-tertiary">{loc}</div> : null}
                {finding.body ? <div className="mt-1 text-sm text-fg-secondary">{finding.body}</div> : null}
              </div>
            );
          })
        )}
      </div>
      {review.overallExplanation ? (
        <div className="mt-3 whitespace-pre-wrap text-sm text-fg-secondary">{review.overallExplanation}</div>
      ) : null}
      </> : null}
    </div>
  );
}

export function ChatMarkdownView({
  taskRunId,
  content: snapshotContent,
  sourceConversationId,
  sourcePartIds = [],
  compact,
  conversationId,
  projectId,
  streaming = false,
  animateInitialContent = false,
  onProgressiveRenderComplete,
  responseRunId,
  immediateFirstCommit = false,
}: {
  content: string;
  sourceConversationId?: string | null;
  sourcePartIds?: string[];
  taskRunId?: string;
  compact?: boolean;
  conversationId?: string | null;
  projectId?: string | null;
  streaming?: boolean;
  animateInitialContent?: boolean;
  onProgressiveRenderComplete?: () => void;
  responseRunId?: string;
  immediateFirstCommit?: boolean;
}) {
  const liveText = useChatTextRun(sourceConversationId, sourcePartIds);
  const content = liveText ?? snapshotContent;
  // Reveal incoming deltas at an adaptive cadence without replaying the
  // current snapshot when this view first mounts.
  const generatedMetricsKey = useId();
  const metricsKey = `assistant-markdown-${generatedMetricsKey}`;
  const streamingContent = useProgressiveStreamingMarkdown(
    content,
    streaming,
    metricsKey,
    animateInitialContent,
    onProgressiveRenderComplete,
    immediateFirstCommit,
  );
  useEffect(() => {
    if (!streaming) return;
    startStreamingRenderMetrics(metricsKey);
    return () => finishStreamingRenderMetrics(metricsKey);
  }, [metricsKey, streaming]);
  const setPreview = useWorkspacePreviewStore((s) => s.setPath);
  const language = useLocaleStore((s) => s.language);
  const fileReferenceMessages = messages(language).chat.fileReference;

  const loadFileImage = useCallback(async (target: WorkspaceFileLinkTarget) => {
    try {
      return await fetchWorkspaceFileBlob(target.path, {
        projectId: projectId?.trim() || undefined,
        conversationId: conversationId?.trim() || undefined,
        taskRunId,
      });
    } catch (error) {
      if (taskRunId || projectId || !conversationId) throw error;
      return fetchWorkspaceFileBlob(target.path);
    }
  }, [projectId, conversationId, taskRunId]);

  const openFile = useCallback(
    function openReference(target: WorkspaceFileLinkTarget) {
      const workspace = useRightWorkspaceStore.getState();
      const scope = workspace.scope;
      const request: FileReferencePreview = { status: 'loading', target };
      const context = { projectId: projectId?.trim() || undefined, conversationId: conversationId?.trim() || undefined, taskRunId };
      const id = workspace.openFile({ path: target.path, projectId: context.projectId, conversationId: context.conversationId, reference: request }, scope);
      const pending = { id, scope, reference: request };
      const isCurrent = () => useRightWorkspaceStore.getState().panes[scope]?.tabs.some(tab =>
        tab.id === id && tab.kind === 'file' && tab.reference === request);
      const retry = () => openReference(target);
      void (async () => {
        const scoped = await resolveWorkspaceFileReference(target.path, context);
        if (!isCurrent()) return;
        const path = scoped?.absolutePath || scoped?.workspaceRelativePath;
        if (path && scoped?.capabilities.includes('preview')) {
          setPreview(path, target.line, projectId, conversationId, undefined, {
            ...pending, resolvedFile: scoped.fileId ? { id: scoped.fileId, mtimeMs: scoped.mtimeMs } : undefined,
          });
          return;
        }
        // A forwarded result can belong to the default workspace instead of the chat's Agent.
        if (target.kind === 'workspace-relative' && !taskRunId && !projectId && conversationId) {
          const fallback = await resolveWorkspaceFileReference(target.path);
          const fallbackPath = fallback?.absolutePath || fallback?.workspaceRelativePath;
          if (fallbackPath && fallback?.capabilities.includes('preview')) {
            setPreview(fallbackPath, target.line, undefined, undefined, undefined, {
              ...pending, defaultWorkspace: true,
              resolvedFile: fallback.fileId ? { id: fallback.fileId, mtimeMs: fallback.mtimeMs } : undefined,
            });
            return;
          }
        }
        workspace.finishFileReference(id, scope, request, {
          reference: scoped ? { status: 'ready', target, ref: scoped, retry: scoped.exists ? undefined : retry }
            : { status: 'error', target, message: fileReferenceMessages.resolveFailedDescription, retry },
        });
      })().catch(error => {
        workspace.finishFileReference(id, scope, request, {
          reference: { status: 'error', target, message: error instanceof Error ? error.message : String(error), retry },
        });
      });
    },
    [fileReferenceMessages.resolveFailedDescription, projectId, conversationId, taskRunId, setPreview],
  );

  const providerPayload = parseProviderSetupRequired(content);
  return (
    <>
      {providerPayload ? <ProviderSetupRequiredCard payload={providerPayload} /> : <MarkdownView
        content={streamingContent}
        streaming={streaming || streamingContent !== content}
        compact={compact}
        onWorkspaceFileOpen={openFile}
        onWorkspaceImageLoad={loadFileImage}
        renderMermaid
        mermaidActions
        streamingMetricsKey={metricsKey}
        responseRunId={responseRunId}
      />}
    </>
  );
}

function renderTextOrImageBlock(
  block: MessageContent,
  key: string,
  isUser: boolean,
  isAssistantMessageStreaming: boolean,
  imagePreviewLabel: string,
  onImagePreview?: (block: ImageContent, index: number) => void,
  contentIndex?: number,
  conversationId?: string | null,
  workspaceConversationId?: string | null,
  projectId?: string | null,
  animateInitialContent?: boolean,
  onProgressiveRenderComplete?: () => void,
  userTurnDocument?: UserTurnDocument,
  contextRefs?: MessageContextRef[],
  taskRunId?: string,
  responseRunId?: string,
  immediateFirstCommit?: boolean,
) {
  if (block.type === 'text') {
    if (isUser) {
      const displayText = stripUserMessageForDisplay(block.text ?? '');
      return (
        <div key={key} className="min-w-0">
          <UserMessageSegments
            text={displayText}
            conversationId={conversationId}
            document={userTurnDocument}
            contextRefs={contextRefs}
          />
        </div>
      );
    }

    return (
      <div key={key} className="assistant-markdown-content markdown-content min-w-0">
        <ChatMarkdownView
          content={block.text}
          sourcePartIds={textRunSourceIds(block)}
          sourceConversationId={conversationId}
          taskRunId={taskRunId}
          compact
          conversationId={workspaceConversationId ?? conversationId}
          projectId={projectId}
          streaming={isAssistantMessageStreaming}
          animateInitialContent={animateInitialContent}
          onProgressiveRenderComplete={onProgressiveRenderComplete}
          responseRunId={responseRunId}
          immediateFirstCommit={immediateFirstCommit}
        />
      </div>
    );
  }
  if (block.type === 'image' && block.source?.data) {
    const idx = contentIndex ?? 0;
    return <ChatImageThumbnail key={key} source={block.source.data} alt="" title={imagePreviewLabel}
      onOpen={onImagePreview ? () => onImagePreview(block, idx) : undefined} />;
  }
  if (block.type === 'review') {
    return <ReviewBlock key={key} review={block} />;
  }
  return null;
}

export function ChunkedContent({
  taskRunId,
  content,
  isUser,
  isAssistantMessageStreaming,
  imagePreviewLabel,
  onImagePreview,
  conversationId,
  workspaceConversationId,
  projectId,
  progressiveRender = false,
  onProgressiveRenderComplete,
  userTurnDocument,
  contextRefs,
  responseRunId,
  immediateFirstCommit = false,
  renderActivity,
  processItems,
  processCollapsed = false,
}: {
  content: MessageContent[];
  taskRunId?: string;
  isUser: boolean;
  isAssistantMessageStreaming: boolean;
  imagePreviewLabel: string;
  onImagePreview: ((block: ImageContent, index: number) => void) | undefined;
  conversationId: string | null | undefined;
  workspaceConversationId?: string | null;
  projectId?: string | null;
  progressiveRender?: boolean;
  onProgressiveRenderComplete?: () => void;
  userTurnDocument?: UserTurnDocument;
  contextRefs?: MessageContextRef[];
  responseRunId?: string;
  immediateFirstCommit?: boolean;
  renderActivity?: (blocks: Array<ThinkingContent | ToolUseContent>, isTail: boolean) => ReactNode;
  processItems?: ReadonlySet<MessageContent>;
  processCollapsed?: boolean;
}) {
  const renderContent = isUser ? content : mergeConsecutiveTextBlocks(content);
  const processKeys = new Set(processItems ? [...processItems].map(knownPartRenderKey).filter(Boolean) : []);
  const isProcess = (block: MessageContent) => processItems?.has(block)
    || Boolean(knownPartRenderKey(block) && processKeys.has(knownPartRenderKey(block)));
  const pendingTextIndex = renderContent.findLastIndex(
    (block) => block.type === 'text' && block.presentation === 'pending',
  );
  const tailBlock = renderContent.at(-1);
  const fallbackStreamingTextIndex = pendingTextIndex < 0
    && tailBlock?.type === 'text'
    && tailBlock.presentation === undefined
      ? renderContent.length - 1
      : -1;
  const streamingTextIndex = isAssistantMessageStreaming
    ? Math.max(pendingTextIndex, fallbackStreamingTextIndex)
    : -1;
  const nodes: ReactNode[] = [];
  let i = 0;
  let imageOrdinal = 0;
  while (i < renderContent.length) {
    const b = renderContent[i];

    if (b.type === 'thinking' || b.type === 'tool_use') {
      const start = i;
      const activity: Array<ThinkingContent | ToolUseContent> = [];
      while (i < renderContent.length) {
        const activityBlock = renderContent[i];
        if (activityBlock.type !== 'thinking' && activityBlock.type !== 'tool_use') break;
        activity.push(activityBlock);
        i++;
      }
      if (renderActivity) nodes.push(
        <div key={knownPartRenderKey(b) ?? `activity-${start}`} data-assistant-activity
          data-assistant-process-item={processItems ? true : undefined} hidden={processCollapsed}>
          {renderActivity(activity, i === renderContent.length)}
        </div>,
      );
    } else {
      const imgIdx = b.type === 'image' ? imageOrdinal++ : 0;
      const el = renderTextOrImageBlock(
        b,
        knownPartRenderKey(b) ?? `block-${i}`,
        isUser,
        i === streamingTextIndex,
        imagePreviewLabel,
        onImagePreview,
        b.type === 'image' ? imgIdx : i,
        conversationId,
        workspaceConversationId,
        projectId,
        progressiveRender,
        onProgressiveRenderComplete,
        isUser && i === 0 ? userTurnDocument : undefined,
        isUser && i === 0 ? contextRefs : undefined,
        taskRunId,
        responseRunId,
        immediateFirstCommit,
      );
      if (el) nodes.push(processItems ? (
        <div key={knownPartRenderKey(b) ?? `block-${i}`} data-assistant-process-item={isProcess(b) || undefined}
          hidden={processCollapsed && isProcess(b)}>{el}</div>
      ) : el);
      i++;
    }
  }
  return <>{nodes}</>;
}
