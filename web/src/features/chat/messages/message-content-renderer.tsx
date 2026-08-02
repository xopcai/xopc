// Block-level renderers used by MessageBubble. Assistant activity is collected
// into one turn-level disclosure instead of fragmenting the reply around text.

import {
  useCallback,
  useEffect,
  useId,
  useMemo,
  useState,
  type ReactNode,
} from 'react';
import { AlertCircle, Copy, ExternalLink, File, FolderOpen, Loader2, X } from 'lucide-react';

import { MarkdownView } from '@/features/chat/markdown/markdown-view';
import type { WorkspaceFileLinkTarget } from '@/components/markdown/internal-links';
import {
  AssistantStepsBlock,
  type AssistantActivityWorkflowOptions,
} from '@/features/chat/messages/assistant-steps-block';
import type {
  ImageContent,
  MessageContent,
  ReviewContent,
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
import { ProviderSetupRequiredCard } from '@/features/chat/messages/provider-setup-required-banner';
import { parseProviderSetupRequired } from '@/features/chat/messages/provider-setup-required.parser';
import {
  resolveFileReferenceAction,
  resolveWorkspaceFileReference,
  type WorkspaceFileReference,
} from '@/features/workspace/workspace-api';
import {
  mergeConsecutiveTextBlocks,
  prepareStreamingMarkdown,
} from '@/features/chat/messages/streaming-markdown';
import { buildStreamingMarkdownRenderBlocks } from '@/components/markdown/parse-markdown';
import {
  finishStreamingRenderMetrics,
  recordStreamingShape,
  startStreamingRenderMetrics,
} from '@/components/markdown/streaming-render-metrics';
import { useProgressiveStreamingMarkdown } from '@/features/chat/messages/use-progressive-streaming-markdown';
import type { AssistantTurnActivityPresentation } from '@/features/chat/messages/assistant-turn-view-model';
import { messages } from '@/i18n/messages';
import { cn } from '@/lib/cn';
import { copyTextToClipboard } from '@/lib/copy-to-clipboard';
import { isElectron } from '@/lib/electron-env';
import { interaction } from '@/lib/interaction';
import { useLocaleStore } from '@/stores/locale-store';
import { useWorkspacePreviewStore } from '@/stores/workspace-preview-store';

type MarkdownFileResolution =
  | { status: 'loading'; target: WorkspaceFileLinkTarget }
  | { status: 'ready'; target: WorkspaceFileLinkTarget; ref: WorkspaceFileReference }
  | { status: 'error'; target: WorkspaceFileLinkTarget; message: string };

function reviewLocation(finding: ReviewContent['findings'][number]): string {
  if (!finding.filePath) return '';
  if (!finding.lineStart) return finding.filePath;
  const end = finding.lineEnd && finding.lineEnd !== finding.lineStart ? `-${finding.lineEnd}` : '';
  return `${finding.filePath}:${finding.lineStart}${end}`;
}

function ReviewBlock({ review }: { review: ReviewContent }) {
  const isRunning = review.status === 'preparing' || review.status === 'reviewing';
  const isPreparing = review.status === 'preparing';
  const modelReviewIncomplete = review.source === 'local' && review.overallCorrectness === 'unknown';
  const correctnessTone =
    review.overallCorrectness === 'patch is incorrect'
      ? 'border-red-500/30 bg-red-500/5 text-red-700 dark:text-red-300'
      : review.overallCorrectness === 'patch is correct'
        ? 'border-emerald-500/30 bg-emerald-500/5 text-emerald-700 dark:text-emerald-300'
        : 'border-edge bg-surface-muted text-fg-secondary';
  return (
    <div className="min-w-0 rounded-lg border border-edge bg-surface-subtle p-3">
      <div className="flex flex-wrap items-center gap-2">
        {isRunning ? <Loader2 className="size-4 animate-spin text-accent" aria-hidden /> : null}
        <div className="text-sm font-semibold text-fg-primary">
          {isRunning ? 'Reviewing changes' : 'Code review finished'}
        </div>
        {isRunning ? (
          <div className="rounded-md border border-edge bg-surface-muted px-1.5 py-0.5 text-[11px] font-medium text-fg-secondary">
            {isPreparing ? 'Collecting changes' : 'Review assistant'}
          </div>
        ) : (
          <div className={cn('rounded-md border px-1.5 py-0.5 text-[11px] font-medium', correctnessTone)}>
            {review.overallCorrectness}
          </div>
        )}
      </div>
      <div className="mt-1 text-xs text-fg-tertiary">Based on {review.target}</div>
      {isRunning && !review.analysisMarkdown ? (
        <div className="mt-3 text-sm text-fg-secondary">
          {isPreparing ? 'Preparing an isolated review context…' : 'The review assistant is checking the changes…'}
        </div>
      ) : null}
      {review.analysisMarkdown ? (
        <div className="mt-3 rounded-md border border-edge-subtle bg-surface px-2.5 py-2">
          <div className="mb-1 text-xs font-medium text-fg-secondary">Review assistant</div>
          <MarkdownView content={review.analysisMarkdown} compact openHttpLinksInNewTab />
        </div>
      ) : null}
      {review.status === 'error' && review.errorMessage ? (
        <div className="mt-3 rounded-md border border-warning/30 bg-warning/5 px-2.5 py-2 text-sm text-warning">
          The review assistant could not complete: {review.errorMessage}
        </div>
      ) : null}
      {!isRunning ? <>
      {review.summary ? (
        <div className="mt-3 text-sm text-fg-secondary">{review.summary}</div>
      ) : null}
      <div className="mt-3 space-y-2">
        {review.findings.length === 0 ? (
          <div className="text-sm text-fg-secondary">
            {modelReviewIncomplete ? 'No model findings were produced.' : 'No findings.'}
          </div>
        ) : (
          review.findings.map((finding, index) => {
            const loc = reviewLocation(finding);
            return (
              <div key={`${finding.title}-${index}`} className="rounded-md border border-edge bg-surface p-2">
                <div className="flex flex-wrap items-center gap-2">
                  <span className="rounded border border-edge bg-surface-muted px-1.5 py-0.5 text-[11px] font-semibold text-fg-secondary">
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

function ChatMarkdownFileActionCard({
  resolution,
  sessionKey,
  onClose,
}: {
  resolution: MarkdownFileResolution;
  sessionKey?: string | null;
  onClose: () => void;
}) {
  const language = useLocaleStore((s) => s.language);
  const m = messages(language).chat.fileReference;
  const [copied, setCopied] = useState(false);
  const canUseShell = isElectron() && Boolean(window.electronAPI?.shell);

  const targetPath = resolution.target.path;
  const ref = resolution.status === 'ready' ? resolution.ref : null;
  const displayName = ref?.displayName ?? targetPath.split(/[\\/]/).pop() ?? targetPath;
  const displayPath = ref?.absolutePath ?? targetPath;

  const copyPath = useCallback(() => {
    void copyTextToClipboard(displayPath).then((ok) => {
      if (!ok) return;
      setCopied(true);
      window.setTimeout(() => setCopied(false), 2000);
    });
  }, [displayPath]);

  const runAction = useCallback(
    async (action: 'openExternal' | 'revealInFolder') => {
      if (!ref?.fileRefId || !canUseShell) return;
      const resolved = await resolveFileReferenceAction(ref.fileRefId, action, {
        sessionKey: sessionKey?.trim() || undefined,
      });
      if (!resolved) return;
      if (action === 'openExternal') {
        await window.electronAPI?.shell?.openPath(resolved.absolutePath);
      } else {
        await window.electronAPI?.shell?.showItemInFolder(resolved.absolutePath);
      }
    },
    [canUseShell, ref?.fileRefId, sessionKey],
  );

  const tone =
    resolution.status === 'ready' && resolution.ref.exists && resolution.ref.scope !== 'missing'
      ? 'border-edge-subtle bg-surface-panel'
      : 'border-warning/30 bg-warning/5';

  return (
    <div className={cn('mt-2 flex max-w-xl min-w-0 flex-col gap-1.5 rounded-lg border px-2.5 py-2 text-xs', tone)}>
      <div className="flex min-w-0 items-center gap-1.5">
        {resolution.status === 'loading' ? (
          <Loader2 className="size-3.5 shrink-0 animate-spin text-fg-muted" strokeWidth={1.75} aria-hidden />
        ) : resolution.status === 'error' || ref?.scope === 'missing' || ref?.scope === 'invalid' ? (
          <AlertCircle className="size-3.5 shrink-0 text-warning" strokeWidth={1.75} aria-hidden />
        ) : (
          <File className="size-3.5 shrink-0 text-accent" strokeWidth={1.75} aria-hidden />
        )}
        <span className="min-w-0 truncate font-medium">{displayName}</span>
        <button
          type="button"
          onClick={onClose}
          className={cn('ml-auto inline-flex size-5 shrink-0 items-center justify-center rounded text-fg-muted hover:bg-surface-hover hover:text-fg', interaction.focusRingPanel)}
          aria-label={m.closeActions}
        >
          <X className="size-3" strokeWidth={1.75} aria-hidden />
        </button>
      </div>
      <p className="line-clamp-2 break-all text-[11px] leading-snug text-fg-muted">
        {resolution.status === 'loading'
          ? m.resolvingDescription
          : resolution.status === 'error'
            ? resolution.message
            : ref?.scope === 'missing'
              ? m.missingDescription
              : ref?.scope === 'invalid'
                ? m.invalidDescription
                : canUseShell
                  ? m.externalDescription
                  : m.browserExternalDescription}
      </p>
      <div className="flex flex-wrap items-center gap-1 pt-0.5">
        {canUseShell && ref?.capabilities.includes('openExternal') ? (
          <button
            type="button"
            className={fileActionButtonClass}
            onClick={() => void runAction('openExternal')}
          >
            <ExternalLink className="size-3" strokeWidth={1.75} aria-hidden />
            <span>{m.openExternal}</span>
          </button>
        ) : null}
        {canUseShell && ref?.capabilities.includes('revealInFolder') ? (
          <button
            type="button"
            className={fileActionButtonClass}
            onClick={() => void runAction('revealInFolder')}
          >
            <FolderOpen className="size-3" strokeWidth={1.75} aria-hidden />
            <span>{m.revealInFolder}</span>
          </button>
        ) : null}
        <button type="button" className={fileActionButtonClass} onClick={copyPath}>
          <Copy className="size-3" strokeWidth={1.75} aria-hidden />
          <span>{copied ? messages(language).chat.messageCopied : m.copyPath}</span>
        </button>
      </div>
    </div>
  );
}

const fileActionButtonClass = cn(
  'inline-flex items-center gap-1 rounded-md px-1.5 py-0.5 text-[11px] text-fg-muted transition-colors hover:bg-surface-hover hover:text-fg',
  interaction.focusRingPanel,
  interaction.press,
);

function ChatMarkdownView({
  content,
  compact,
  sessionKey,
  streaming = false,
  animateInitialContent = false,
  onProgressiveRenderComplete,
}: {
  content: string;
  compact?: boolean;
  sessionKey?: string | null;
  streaming?: boolean;
  animateInitialContent?: boolean;
  onProgressiveRenderComplete?: () => void;
}) {
  // Reveal bounded chunks at an adaptive cadence so fast providers remain
  // perceptible without forcing one render per raw delta.
  const generatedMetricsKey = useId();
  const metricsKey = `assistant-markdown-${generatedMetricsKey}`;
  const streamingContent = useProgressiveStreamingMarkdown(
    content,
    streaming,
    metricsKey,
    animateInitialContent,
    onProgressiveRenderComplete,
  );
  const [hasStreamed, setHasStreamed] = useState(streaming || animateInitialContent);
  useEffect(() => {
    if (streaming) setHasStreamed(true);
  }, [streaming]);
  const progressivelyRevealing = streaming || streamingContent !== content;
  const preserveStreamingLayout = streaming || hasStreamed;
  const blockSource = streamingContent;
  const streamingBlocks = useMemo(
    () => buildStreamingMarkdownRenderBlocks(blockSource),
    [blockSource],
  );
  useEffect(() => {
    if (!progressivelyRevealing) return;
    startStreamingRenderMetrics(metricsKey);
    return () => finishStreamingRenderMetrics(metricsKey);
  }, [metricsKey, progressivelyRevealing]);
  useEffect(() => {
    if (!preserveStreamingLayout) return;
    const tail = streamingBlocks.at(-1);
    recordStreamingShape(
      metricsKey,
      Math.max(0, streamingBlocks.length - 1),
      tail?.content.length ?? 0,
    );
  }, [metricsKey, preserveStreamingLayout, streamingBlocks]);
  const setPreview = useWorkspacePreviewStore((s) => s.setPath);
  const language = useLocaleStore((s) => s.language);
  const fileReferenceMessages = messages(language).chat.fileReference;
  const [resolution, setResolution] = useState<MarkdownFileResolution | null>(null);

  const openFile = useCallback(
    (target: WorkspaceFileLinkTarget) => {
      if (target.kind === 'workspace-relative') {
        setPreview(target.path, target.line);
        setResolution(null);
        return;
      }

      setResolution({ status: 'loading', target });
      void resolveWorkspaceFileReference(target.path, { sessionKey: sessionKey?.trim() || undefined })
        .then((ref) => {
          if (!ref) {
            setResolution({
              status: 'error',
              target,
              message: fileReferenceMessages.resolveFailedDescription,
            });
            return;
          }
          if (ref.scope === 'workspace' && ref.workspaceRelativePath) {
            setPreview(ref.workspaceRelativePath, target.line);
            setResolution(null);
            return;
          }
          setResolution({ status: 'ready', target, ref });
        })
        .catch((err) => {
          setResolution({
            status: 'error',
            target,
            message: err instanceof Error ? err.message : String(err),
          });
        });
    },
    [fileReferenceMessages.resolveFailedDescription, sessionKey, setPreview],
  );

  return (
    <>
      {preserveStreamingLayout ? (
        <div className="markdown-stream-blocks">
          {streamingBlocks.map((block) => (
            <MarkdownView
              key={block.key}
              content={
                progressivelyRevealing && block.isTail
                  ? prepareStreamingMarkdown(block.content)
                  : block.content
              }
              compact={compact}
              className={cn(
                'markdown-stream-block',
                block.isTail && 'markdown-stream-tail',
              )}
              onWorkspaceFileOpen={openFile}
              openHttpLinksInNewTab
              renderMermaid={!progressivelyRevealing}
              streamingMetricsKey={metricsKey}
            />
          ))}
        </div>
      ) : (
        <MarkdownView
          content={content}
          compact={compact}
          onWorkspaceFileOpen={openFile}
          openHttpLinksInNewTab
        />
      )}
      {resolution ? (
        <ChatMarkdownFileActionCard
          resolution={resolution}
          sessionKey={sessionKey}
          onClose={() => setResolution(null)}
        />
      ) : null}
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
  sessionKey?: string | null,
  animateInitialContent?: boolean,
  onProgressiveRenderComplete?: () => void,
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

    // Intercept upstream "No API key found" messages rendered as assistant text
    const providerPayload = parseProviderSetupRequired(block.text ?? '');
    if (providerPayload) {
      return (
        <div key={key} className="min-w-0">
          <ProviderSetupRequiredCard payload={providerPayload} />
        </div>
      );
    }

    return (
      <div key={key} className="markdown-content min-w-0">
        <ChatMarkdownView
          content={block.text}
          compact
          sessionKey={sessionKey}
          streaming={isAssistantMessageStreaming}
          animateInitialContent={animateInitialContent}
          onProgressiveRenderComplete={onProgressiveRenderComplete}
        />
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
            className="max-h-48 max-w-64 rounded-lg align-top object-contain"
            alt=""
          />
        </button>
      );
    }
    return (
      <img
        key={key}
        src={block.source.data}
        className="max-h-48 max-w-64 rounded-lg object-contain"
        alt=""
      />
    );
  }
  if (block.type === 'review') {
    return <ReviewBlock key={key} review={block} />;
  }
  return null;
}

export function ChunkedContent({
  content,
  isUser,
  isAssistantMessageStreaming,
  toolLabels,
  stepLabels,
  clusterLabels,
  cardLabels,
  imagePreviewLabel,
  onImagePreview,
  sessionKey,
  workflowOptions,
  assistantActivity,
  progressiveRender = false,
  onProgressiveRenderComplete,
}: {
  content: MessageContent[];
  isUser: boolean;
  isAssistantMessageStreaming: boolean;
  toolLabels: { input: string; output: string; noOutput: string };
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
    activityCompleted: string;
    activityPartial: string;
    activityFailedCount: string;
    activityAnalysisComplete: string;
    toolFailedImpact: string;
    rawThinking: string;
    toolRunning: string;
    toolError: string;
  };
  clusterLabels: {
    done: StepsClusterDoneLabels;
    ing: StepsClusterIngLabels;
    join: StepsClusterJoinLabels;
  };
  cardLabels: ToolCardLabels;
  imagePreviewLabel: string;
  onImagePreview: ((block: ImageContent, index: number) => void) | undefined;
  sessionKey: string | null | undefined;
  workflowOptions: AssistantActivityWorkflowOptions;
  assistantActivity?: AssistantTurnActivityPresentation;
  progressiveRender?: boolean;
  onProgressiveRenderComplete?: () => void;
}) {
  const renderContent = isUser ? content : mergeConsecutiveTextBlocks(content);
  const nodes: ReactNode[] = [];
  const activityBlocks = isUser ? [] : (assistantActivity?.blocks ?? []);
  let activityRendered = false;
  let i = 0;
  let imageOrdinal = 0;
  while (i < renderContent.length) {
    const b = renderContent[i];

    if (b.type === 'thinking' || b.type === 'tool_use') {
      if (
        !isUser &&
        assistantActivity &&
        !activityRendered &&
        activityBlocks.length > 0
      ) {
        nodes.push(
          <AssistantStepsBlock
            key="turn-activity"
            activity={assistantActivity}
            toolLabels={toolLabels}
            stepLabels={stepLabels}
            clusterLabels={clusterLabels}
            cardLabels={cardLabels}
            sessionKey={sessionKey}
            workflowOptions={workflowOptions}
          />,
        );
        activityRendered = true;
      }
      i++;
    } else {
      const imgIdx = b.type === 'image' ? imageOrdinal++ : 0;
      const el = renderTextOrImageBlock(
        b,
        `block-${i}`,
        isUser,
        isAssistantMessageStreaming,
        imagePreviewLabel,
        onImagePreview,
        b.type === 'image' ? imgIdx : i,
        sessionKey,
        progressiveRender,
        onProgressiveRenderComplete,
      );
      if (el) nodes.push(el);
      i++;
    }
  }
  return <>{nodes}</>;
}
