import { memo, useEffect, useMemo, useState } from 'react';
import { CheckCircle2, ChevronDown, Loader2, XCircle } from 'lucide-react';
import { Link } from 'react-router-dom';

import {
  buildStepsRoundCompleteSummary,
  buildStepsRoundStreamingSummary,
  viewStepsLabel,
} from '@/features/chat/messages/assistant-steps-summary';
import type {
  ThinkingContent,
  ToolUseContent,
} from '@/features/chat/messages/messages.types';
import {
  buildMemoryActivityView,
  type MemoryActivityLabels,
} from '@/features/chat/messages/memory-activity';
import type { AssistantTurnActivityPresentation } from '@/features/chat/messages/assistant-turn-view-model';
import { formatParamsJson, getKeyDetailLine } from '@/features/chat/messages/tool-input-preview';
import { getFriendlyToolTitle } from '@/features/chat/messages/tool-friendly-title';
import {
  classifyTool,
  type ActionKind,
  type StepsClusterDoneLabels,
  type StepsClusterIngLabels,
  type StepsClusterJoinLabels,
} from '@/features/chat/messages/tool-action-cluster';
import {
  EditFileCard,
  FetchUrlCard,
  ReadFileCard,
  CommandCard,
  WriteFileCard,
  type ToolCardLabels,
} from '@/features/chat/tool-results/tool-result-cards';
import { useDevViewStore } from '@/stores/dev-view-store';
import { formatStepRoundDuration } from '@/features/chat/time/step-round-duration';
import {
  BrowserSetupRequiredCard,
} from '@/features/chat/tool-results/browser-setup-required-card';
import { parseBrowserSetupRequired } from '@/features/chat/tool-results/browser-setup-required-parser';
import { ExtensionChatWidget } from '@/features/extensions/extension-chat-widget';
import { useUiExtensions } from '@/features/extensions/extension-provider';
import { useChatWidgetMatch } from '@/features/extensions/use-chat-widget-match';
import { ProductDeliveryCard } from '@/features/chat/product-delivery/product-delivery-card';
import { extractProductDelivery } from '@/features/chat/product-delivery/product-delivery';
import { cn } from '@/lib/cn';
import { interaction } from '@/lib/interaction';
import type { StoredLanguage } from '@/lib/storage';
import { useLocaleStore } from '@/stores/locale-store';
import { WorkflowCard, type WorkflowCardLabels } from '@/features/chat/workflow/workflow-card';
import { isWorkflowToolBlock } from '@/features/chat/workflow/workflow.utils';

export interface AssistantActivityWorkflowOptions {
  labels: WorkflowCardLabels;
}

const AssistantStepsHeaderStatusIcon = memo(function AssistantStepsHeaderStatusIcon({
  active,
  failed,
}: {
  active: boolean;
  failed: boolean;
}) {
  if (active) {
    return <Loader2 className="mt-0.5 size-4 shrink-0 animate-spin text-accent-fg" aria-hidden />;
  }
  if (failed) {
    return <XCircle className="mt-0.5 size-4 shrink-0 text-red-600 dark:text-red-400" aria-hidden />;
  }
  return <CheckCircle2 className="mt-0.5 size-4 shrink-0 text-emerald-600 dark:text-emerald-400" aria-hidden />;
});

/**
 * Live step-round duration ticks locally so parent re-renders (stream tokens, etc.) do not
 * restart spinners or thrash the whole steps card every 500ms.
 */
const StepRoundDurationText = memo(function StepRoundDurationText({
  active,
  startedAt,
  frozenMs,
  language,
  className,
}: {
  active: boolean;
  startedAt: number | null;
  frozenMs: number | null;
  language: StoredLanguage;
  className: string;
}) {
  const [, setTick] = useState(0);
  useEffect(() => {
    if (!active) return;
    const id = window.setInterval(() => setTick((n) => n + 1), 500);
    return () => window.clearInterval(id);
  }, [active]);

  const elapsedMs = active && startedAt != null ? Math.max(0, Date.now() - startedAt) : 0;
  const text =
    active && startedAt != null
      ? formatStepRoundDuration(elapsedMs, language)
      : frozenMs != null
        ? formatStepRoundDuration(frozenMs, language)
        : null;
  if (!text) return null;
  return <span className={className}>{text}</span>;
});

/** One turn-level activity disclosure for model summaries and tool execution. */
export function AssistantStepsBlock({
  activity,
  toolLabels,
  stepLabels,
  clusterLabels,
  cardLabels,
  sessionKey,
  workflowOptions,
}: {
  activity: AssistantTurnActivityPresentation;
  toolLabels: { input: string; output: string; noOutput: string };
  stepLabels: {
    thoughts: string;
    thoughtsStreaming: string;
    viewSteps_one: string;
    viewSteps_other: string;
    searchedWeb: string;
    searchedMemory: string;
    searchedCode: string;
    searched: string;
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
    memoryActivity: MemoryActivityLabels;
  };
  clusterLabels: {
    done: StepsClusterDoneLabels;
    ing: StepsClusterIngLabels;
    join: StepsClusterJoinLabels;
  };
  cardLabels: ToolCardLabels;
  sessionKey?: string | null;
  workflowOptions: AssistantActivityWorkflowOptions;
}) {
  const language = useLocaleStore((s) => s.language);
  const visibleBlocks = activity.blocks;
  const stepCount = visibleBlocks.length;
  const anyActive = activity.active;
  const failedCount = activity.failedCount;
  const stepsDrawerOpen = activity.expandedByDefault;
  const [userExpanded, setUserExpanded] = useState<boolean | null>(null);

  const expanded = userExpanded ?? stepsDrawerOpen;
  const effectiveStartedAt = activity.startedAt ?? null;
  const completedDurationMs = activity.durationMs ?? null;

  const completedHeader = useMemo(() => {
    if (anyActive) return '';
    const detail = buildStepsRoundCompleteSummary(
      visibleBlocks,
      clusterLabels.done,
      clusterLabels.join,
      language,
      viewStepsLabel(stepCount, stepLabels),
    );
    if (failedCount > 0) {
      return `${stepLabels.activityPartial} · ${stepLabels.activityFailedCount.replace(
        /\{\{count\}\}/g,
        String(failedCount),
      )}`;
    }
    return activity.hasTool
      ? `${stepLabels.activityCompleted} · ${detail}`
      : stepLabels.activityAnalysisComplete;
  }, [
    anyActive,
    visibleBlocks,
    language,
    stepCount,
    stepLabels,
    clusterLabels,
    failedCount,
    activity.hasTool,
  ]);

  const streamingHeaderText = useMemo(() => {
    if (!anyActive) return null;
    return buildStepsRoundStreamingSummary(visibleBlocks, clusterLabels.ing);
  }, [anyActive, visibleBlocks, clusterLabels]);

  if (stepCount === 0) {
    return null;
  }

  const timelineLabels = {
    thoughts: stepLabels.thoughts,
    thoughtsStreaming: stepLabels.thoughtsStreaming,
    searchedWeb: stepLabels.searchedWeb,
    searchedMemory: stepLabels.searchedMemory,
    searchedCode: stepLabels.searchedCode,
    searched: stepLabels.searched,
    readFile: stepLabels.readFile,
    stepDetails: stepLabels.stepDetails,
    runCommand: stepLabels.runCommand,
    listDirectory: stepLabels.listDirectory,
    writeFile: stepLabels.writeFile,
    editFile: stepLabels.editFile,
    openUrl: stepLabels.openUrl,
    fetchUrl: stepLabels.fetchUrl,
    unknownTool: stepLabels.unknownTool,
    toolFailedImpact: stepLabels.toolFailedImpact,
    rawThinking: stepLabels.rawThinking,
    toolRunning: stepLabels.toolRunning,
    toolError: stepLabels.toolError,
    memoryActivity: stepLabels.memoryActivity,
  };

  const headerMain = anyActive ? (
    <>
      <span className="[overflow-wrap:anywhere]">
        {streamingHeaderText ?? viewStepsLabel(stepCount, stepLabels)}
      </span>
      <StepRoundDurationText
        active={anyActive}
        startedAt={effectiveStartedAt}
        frozenMs={null}
        language={language}
        className="ml-1.5 tabular-nums text-fg-muted"
      />
    </>
  ) : (
    <>
      <span className="[overflow-wrap:anywhere]">{completedHeader}</span>
    </>
  );

  const headerDurationRight = !anyActive ? (
    <StepRoundDurationText
      active={false}
      startedAt={effectiveStartedAt}
      frozenMs={completedDurationMs}
      language={language}
      className="mt-0.5 tabular-nums text-xs text-fg-muted"
    />
  ) : null;

  return (
    <div className="my-1 w-full min-w-0 overflow-hidden rounded-xl bg-surface-hover/50 dark:bg-surface-hover/30">
      <button
        type="button"
        className={cn(
          'grid w-full min-w-0 grid-cols-[auto_minmax(0,1fr)_auto_auto] items-start gap-x-2 rounded-t-xl px-3 py-2 text-left',
          interaction.transition,
          'hover:bg-surface-hover/80 dark:hover:bg-surface-hover/50',
          'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent focus-visible:ring-offset-2 focus-visible:ring-offset-surface-panel',
        )}
        onClick={() => setUserExpanded((current) => !(current ?? stepsDrawerOpen))}
        aria-expanded={expanded}
      >
        <AssistantStepsHeaderStatusIcon active={anyActive} failed={failedCount > 0} />
        <div className="min-w-0">
          <span className="inline-flex max-w-full flex-wrap items-baseline rounded-md bg-accent-soft/70 px-2 py-0.5 text-xs font-medium text-fg dark:bg-accent-soft/40">
            {headerMain}
          </span>
        </div>
        <span className="flex items-start justify-end">{headerDurationRight}</span>
        <ChevronDown
          className={cn('mt-0.5 size-4 shrink-0 text-fg-muted transition-transform', expanded && 'rotate-180')}
          aria-hidden
        />
      </button>
      {expanded ? (
        <div className="border-t border-edge-subtle/90 px-3 pb-3 pt-2 dark:border-edge-subtle">
          <AssistantStepsTimeline
            blocks={visibleBlocks}
            toolLabels={toolLabels}
            stepLabels={timelineLabels}
            cardLabels={cardLabels}
            sessionKey={sessionKey}
            workflowOptions={workflowOptions}
          />
        </div>
      ) : null}
    </div>
  );
}

export function AssistantStepsTimeline({
  blocks,
  toolLabels,
  stepLabels,
  cardLabels,
  className,
  sessionKey,
  workflowOptions,
}: {
  blocks: Array<ThinkingContent | ToolUseContent>;
  toolLabels: { input: string; output: string; noOutput: string };
  stepLabels: {
    thoughts: string;
    thoughtsStreaming: string;
    searchedWeb: string;
    searchedMemory: string;
    searchedCode: string;
    searched: string;
    readFile: string;
    stepDetails: string;
    runCommand: string;
    listDirectory: string;
    writeFile: string;
    editFile: string;
    openUrl: string;
    fetchUrl: string;
    unknownTool: string;
    toolFailedImpact: string;
    rawThinking: string;
    toolRunning: string;
    toolError: string;
    memoryActivity: MemoryActivityLabels;
  };
  cardLabels: ToolCardLabels;
  className?: string;
  sessionKey?: string | null;
  workflowOptions: AssistantActivityWorkflowOptions;
}) {
  if (blocks.length === 0) {
    return null;
  }

  return (
    <div className={cn('min-w-0 overflow-x-hidden', className)}>
      <div className="ml-1 min-w-0 space-y-3 border-l border-edge-subtle pl-3 dark:border-edge-subtle">
        {blocks.map((b, i) => (
          <StepRow
            key={b.type === 'tool_use' ? b.id : `thinking-${i}`}
            block={b}
            toolLabels={toolLabels}
            stepLabels={stepLabels}
            cardLabels={cardLabels}
            sessionKey={sessionKey}
            workflowOptions={workflowOptions}
          />
        ))}
      </div>
    </div>
  );
}

function ToolUseWidgetSlot({
  toolName,
  toolResult,
}: {
  toolName: string;
  toolResult: unknown;
}) {
  const uiExtensions = useUiExtensions();
  const widgetMatch = useChatWidgetMatch(toolName);

  if (!widgetMatch || uiExtensions.length === 0) return null;

  const extensionInfo = uiExtensions.find((ext) => ext.id === widgetMatch.extensionId);

  return (
    <ExtensionChatWidget
      extensionId={widgetMatch.extensionId}
      extensionName={extensionInfo?.name ?? widgetMatch.extensionId}
      widgetId={widgetMatch.id}
      entrypoint={widgetMatch.entrypoint}
      title={widgetMatch.title}
      toolResult={toolResult}
      maxHeight={widgetMatch.maxHeight ?? 400}
      interactive={widgetMatch.interactive ?? false}
      permissions={extensionInfo?.ui?.permissions}
    />
  );
}

const KINDS_WITH_CARD: ReadonlySet<ActionKind> = new Set([
  'readFile',
  'editFile',
  'writeFile',
  'runCommand',
  'fetchUrl',
]);

function StepRow({
  block,
  toolLabels,
  stepLabels,
  cardLabels,
  sessionKey,
  workflowOptions,
}: {
  block: ThinkingContent | ToolUseContent;
  toolLabels: { input: string; output: string; noOutput: string };
  stepLabels: {
    thoughts: string;
    thoughtsStreaming: string;
    searchedWeb: string;
    searchedMemory: string;
    searchedCode: string;
    searched: string;
    readFile: string;
    stepDetails: string;
    runCommand: string;
    listDirectory: string;
    writeFile: string;
    editFile: string;
    openUrl: string;
    fetchUrl: string;
    unknownTool: string;
    toolFailedImpact: string;
    rawThinking: string;
    toolRunning: string;
    toolError: string;
    memoryActivity: MemoryActivityLabels;
  };
  cardLabels: ToolCardLabels;
  sessionKey?: string | null;
  workflowOptions: AssistantActivityWorkflowOptions;
}) {
  const showRawToolData = useDevViewStore((s) => s.showRawToolData);
  const toolResultText = useMemo(() => {
    if (block.type !== 'tool_use') {
      return '';
    }
    if (block.status === 'running') {
      return '';
    }
    const r = block.result;
    if (r == null) {
      return '';
    }
    if (typeof r === 'string') {
      return r.trim();
    }
    try {
      return JSON.stringify(r, null, 2);
    } catch {
      return String(r);
    }
  }, [block]);

  // browser_use preflight produces a structured "setup required" sentinel.
  // The agent-side text is JSON, so the generic outputPreview would render
  // raw JSON — hide it and render the dedicated card instead.
  const browserSetup = useMemo(() => {
    if (block.type !== 'tool_use' || block.status === 'running') return null;
    if (block.name !== 'browser_use') return null;
    return parseBrowserSetupRequired(toolResultText);
  }, [block, toolResultText]);

  const productDelivery = useMemo(
    () => block.type === 'tool_use' ? extractProductDelivery(block) : null,
    [block],
  );
  const renderProductDelivery = productDelivery
    && productDelivery.primary?.kind !== 'workflow_run'
    && productDelivery.primary?.kind !== 'file'
    ? productDelivery
    : null;

  if (block.type === 'thinking') {
    const streaming = Boolean(block.streaming);
    const text = block.text?.trim() ?? '';
    if (!text && !streaming) return null;

    return (
      <div className="flex min-w-0 gap-2.5">
        <div className="mt-0.5 shrink-0">
          {streaming ? (
            <Loader2 className="size-4 animate-spin text-fg-muted" aria-hidden />
          ) : (
            <CheckCircle2 className="size-4 text-emerald-600 dark:text-emerald-400" aria-hidden />
          )}
        </div>
        <div className="min-w-0 flex-1 space-y-1">
          <span className="inline-flex max-w-full min-w-0 break-words rounded-md bg-accent-soft/60 px-1.5 py-0.5 text-xs font-medium text-fg [overflow-wrap:anywhere] dark:bg-accent-soft/35">
            {streaming ? stepLabels.thoughtsStreaming : stepLabels.thoughts}
          </span>
          {showRawToolData && text ? (
            <details className="group min-w-0 text-xs">
              <summary className="cursor-pointer select-none text-fg-subtle underline-offset-2 hover:text-fg-muted">
                {stepLabels.rawThinking}
              </summary>
              <p className="mt-1 whitespace-pre-wrap break-words text-xs leading-relaxed text-fg-muted [overflow-wrap:anywhere]">
                {text}
              </p>
            </details>
          ) : streaming ? (
            <p className="text-xs text-fg-muted">…</p>
          ) : null}
        </div>
      </div>
    );
  }

  if (isWorkflowToolBlock(block)) {
    return (
      <WorkflowCard
        block={block}
        startedAt={block.startedAt}
        sessionKey={sessionKey}
        labels={workflowOptions.labels}
      />
    );
  }

  const isStreaming = block.status === 'running';
  const isError = block.status === 'error' || block.activity?.status === 'failed';
  const resultText = toolResultText;
  const liveOutputText = isStreaming && block.details && typeof block.details === 'object'
    && !Array.isArray(block.details) && typeof (block.details as { text?: unknown }).text === 'string'
    ? (block.details as { text: string }).text
    : '';

  let outputPreview = resultText ?? '';
  if (outputPreview) {
    try {
      outputPreview = JSON.stringify(JSON.parse(outputPreview), null, 2);
    } catch {
      /* keep */
    }
  }

  const kind = classifyTool(block.name, block.activity);
  const hasCard = KINDS_WITH_CARD.has(kind);
  const memoryActivity = kind === 'memorySearch'
    ? buildMemoryActivityView(block, stepLabels.memoryActivity)
    : null;

  const title = memoryActivity?.title ?? getFriendlyToolTitle(block.name, {
    searchedWeb: stepLabels.searchedWeb,
    searchedMemory: stepLabels.searchedMemory,
    searchedCode: stepLabels.searchedCode,
    searched: stepLabels.searched,
    readFile: stepLabels.readFile,
    runCommand: stepLabels.runCommand,
    listDirectory: stepLabels.listDirectory,
    writeFile: stepLabels.writeFile,
    editFile: stepLabels.editFile,
    openUrl: stepLabels.openUrl,
    fetchUrl: stepLabels.fetchUrl,
    unknownTool: stepLabels.unknownTool,
  }, block.activity);
  const detailLine = memoryActivity ? '' : getKeyDetailLine(block.input);

  const paramsJson = block.input !== undefined ? formatParamsJson(block.input) : '';

  const card = hasCard
    ? kind === 'readFile'
      ? <ReadFileCard block={block} labels={cardLabels} />
      : kind === 'editFile'
        ? <EditFileCard block={block} labels={cardLabels} />
        : kind === 'writeFile'
          ? <WriteFileCard block={block} labels={cardLabels} />
          : kind === 'runCommand'
            ? <CommandCard block={block} labels={cardLabels} />
            : kind === 'fetchUrl'
              ? <FetchUrlCard block={block} labels={cardLabels} />
              : null
    : null;

  // Raw payloads are a developer inspection surface, never a user-facing fallback renderer.
  const showRawDetails = !isStreaming && showRawToolData;

  return (
    <div className="flex min-w-0 gap-2.5">
      <div className="mt-0.5 shrink-0">
        {isStreaming ? (
          <Loader2 className="size-4 animate-spin text-fg-muted" aria-hidden />
        ) : isError ? (
          <XCircle className="size-4 text-red-600 dark:text-red-400" aria-hidden />
        ) : (
          <CheckCircle2 className="size-4 text-emerald-600 dark:text-emerald-400" aria-hidden />
        )}
      </div>
      <div className="min-w-0 flex-1 space-y-1.5">
        <div className="flex min-w-0 flex-wrap items-baseline gap-x-2 gap-y-1">
          <span className="inline-flex max-w-full min-w-0 break-words rounded-md bg-accent-soft/60 px-1.5 py-0.5 text-xs font-medium text-fg [overflow-wrap:anywhere] dark:bg-accent-soft/35">
            {title}
          </span>
          {isStreaming ? (
            <span className="text-xs text-fg-disabled">{stepLabels.toolRunning}</span>
          ) : isError ? (
            <span className="text-xs text-red-600 dark:text-red-400">{stepLabels.toolError}</span>
          ) : null}
        </div>
        {card}
        {memoryActivity ? (
          <div className="space-y-1 text-xs text-fg-muted">
            <p>{memoryActivity.purpose}</p>
            <div className="flex flex-wrap gap-x-3 gap-y-1">
              <Link className="font-medium text-accent-fg hover:underline" to="/you?tab=understanding">
                {stepLabels.memoryActivity.manage}
              </Link>
              <Link className="font-medium text-accent-fg hover:underline" to="/you?tab=privacy">
                {stepLabels.memoryActivity.privacy}
              </Link>
            </div>
            <details>
              <summary className="cursor-pointer select-none text-fg-subtle hover:text-fg-muted">
                {stepLabels.memoryActivity.why}
              </summary>
              <div className="mt-1.5 rounded-md bg-surface-hover/60 px-2 py-1.5 dark:bg-surface-hover/35">
                <p>{stepLabels.memoryActivity.explanation}</p>
              </div>
            </details>
          </div>
        ) : null}
        {isError ? (
          <p className="text-xs leading-relaxed text-red-600 dark:text-red-400">
            {stepLabels.toolFailedImpact}
          </p>
        ) : null}
        {renderProductDelivery ? <ProductDeliveryCard delivery={renderProductDelivery} /> : null}
        {!hasCard && detailLine ? (
          <p className="min-w-0 rounded-md bg-accent-soft/40 px-1.5 py-1 text-xs break-words text-fg-muted [overflow-wrap:anywhere] dark:bg-accent-soft/25">
            {detailLine}
          </p>
        ) : null}
        {liveOutputText ? (
          <pre className="max-h-48 min-w-0 overflow-y-auto overflow-x-hidden rounded-md bg-surface-hover/60 p-2 whitespace-pre-wrap break-words font-mono text-xs leading-relaxed text-fg-muted [overflow-wrap:anywhere] dark:bg-surface-hover/35">
            {liveOutputText}
          </pre>
        ) : null}
        {showRawDetails ? (
          <details className="group min-w-0 text-xs">
            <summary className="cursor-pointer select-none text-fg-subtle underline-offset-2 hover:text-fg-muted group-open:text-fg-muted">
              {hasCard ? cardLabels.rawDetails : stepLabels.stepDetails}
            </summary>
            <div className="mt-2 max-h-48 w-full min-w-0 max-w-full overflow-y-auto overflow-x-hidden rounded-md bg-surface-hover/60 p-2 font-mono dark:bg-surface-hover/35">
              {paramsJson ? (
                <div className="mb-2 min-w-0">
                  <div className="mb-0.5 text-[10px] uppercase tracking-wide text-fg-disabled">{toolLabels.input}</div>
                  <pre className="whitespace-pre-wrap break-words text-fg-muted [overflow-wrap:anywhere]">{paramsJson}</pre>
                </div>
              ) : null}
              <div className="min-w-0">
                <div className="mb-0.5 text-[10px] uppercase tracking-wide text-fg-disabled">{toolLabels.output}</div>
                <pre className="whitespace-pre-wrap break-words text-fg-muted [overflow-wrap:anywhere]">
                  {outputPreview || toolLabels.noOutput}
                </pre>
              </div>
            </div>
          </details>
        ) : null}
        {!isStreaming && !isError ? (
          <ToolUseWidgetSlot toolName={block.name} toolResult={block.result} />
        ) : null}
        {!isStreaming && browserSetup ? (
          <BrowserSetupRequiredCard payload={browserSetup} />
        ) : null}
      </div>
    </div>
  );
}
