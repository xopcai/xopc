import { memo, useEffect, useMemo, useRef, useState } from 'react';
import { ChevronDown } from 'lucide-react';
import { Link } from 'react-router-dom';

import {
  buildStepsRoundStreamingSummary,
} from '@/features/chat/messages/assistant-steps-summary';
import type {
  ThinkingContent,
  ToolUseContent,
} from '@/features/chat/messages/messages.types';
import {
  buildMemoryActivityView,
  type MemoryActivityLabels,
} from '@/features/chat/messages/memory-activity';
import type {
  AssistantTurnWorkLogPresentation,
  AssistantWorkLogItem,
} from '@/features/chat/messages/assistant-turn-view-model';
import { MarkdownView } from '@/features/chat/markdown/markdown-view';
import { formatParamsJson, getKeyDetailLine } from '@/features/chat/messages/tool-input-preview';
import {
  getToolExecutionTitle,
  hasSpecificToolExecutionTitle,
  type ToolExecutionLabels,
} from '@/features/chat/messages/tool-friendly-title';
import {
  classifyTool,
  actionKindRunningLabel,
  type ActionKind,
  type StepsClusterIngLabels,
} from '@/features/chat/messages/tool-action-cluster';
import {
  EditFileCard,
  FetchUrlCard,
  ReadFileCard,
  CommandCard,
  WriteFileCard,
  type ToolCardLabels,
} from '@/features/chat/tool-results/tool-result-cards';
import { parseToolResult } from '@/features/chat/tool-results/parse-tool-result';
import { useDevViewStore } from '@/stores/dev-view-store';
import { formatStepRoundDuration } from '@/features/chat/time/step-round-duration';
import {
  BrowserSetupRequiredCard,
} from '@/features/chat/tool-results/browser-setup-required-card';
import { parseBrowserSetupRequired } from '@/features/chat/tool-results/browser-setup-required-parser';
import { BrowserApprovalCard } from '@/features/chat/tool-results/browser-approval-card';
import { parseBrowserApproval } from '@/features/chat/tool-results/browser-approval';
import { ExtensionChatWidget } from '@/features/extensions/extension-chat-widget';
import { useUiExtensions } from '@/features/extensions/extension-provider';
import { useChatWidgetMatch } from '@/features/extensions/use-chat-widget-match';
import { routeWheelThroughVerticalScrollChain } from '@/features/chat/scroll/wheel-scroll-chain';
import { cn } from '@/lib/cn';
import type { StoredLanguage } from '@/lib/storage';
import { useLocaleStore } from '@/stores/locale-store';
import { WorkflowCard, type WorkflowCardLabels } from '@/features/chat/workflow/workflow-card';
import { isWorkflowToolBlock } from '@/features/chat/workflow/workflow.utils';

export interface AssistantActivityWorkflowOptions {
  labels: WorkflowCardLabels;
}

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

/** One turn-level disclosure for narration, reasoning summaries, and tool execution. */
export function AssistantStepsBlock({
  workLog,
  toolLabels,
  stepLabels,
  clusterLabels,
  cardLabels,
  conversationId,
  workflowOptions,
}: {
  workLog: AssistantTurnWorkLogPresentation;
  toolLabels: { input: string; output: string; noOutput: string };
  stepLabels: {
    thoughts: string;
    thoughtsStreaming: string;
    workLogTitle: string;
    workLogRunning: string;
    workLogComplete: string;
    workLogPartial: string;
    workLogFailed: string;
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
    rawThinking: string;
    toolError: string;
    toolActivity: ToolExecutionLabels;
    memoryActivity: MemoryActivityLabels;
  };
  clusterLabels: {
    ing: StepsClusterIngLabels;
  };
  cardLabels: ToolCardLabels;
  conversationId?: string | null;
  workflowOptions: AssistantActivityWorkflowOptions;
}) {
  const language = useLocaleStore((s) => s.language);
  const showRawToolData = useDevViewStore((s) => s.showRawToolData);
  const visibleItems = useMemo(() => workLog.items.filter((item) => (
    item.type !== 'thinking' || showRawToolData
  )), [workLog.items, showRawToolData]);
  const activityBlocks = useMemo(
    () => workLog.items.filter(
      (item): item is ThinkingContent | ToolUseContent => item.type !== 'text',
    ),
    [workLog.items],
  );
  const stepCount = visibleItems.length;
  const anyActive = workLog.active;
  const stepsDrawerOpen = workLog.expandedByDefault && anyActive;
  const [userExpanded, setUserExpanded] = useState<boolean | null>(null);

  const expanded = !workLog.compact && (userExpanded ?? stepsDrawerOpen);
  const effectiveStartedAt = workLog.startedAt ?? null;
  const completedDurationMs = workLog.durationMs ?? null;
  const friendlyTitleLabels = useMemo(() => ({
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
  }), [stepLabels]);

  const semanticTitle = useMemo(() => (
    block: ToolUseContent,
    state: 'running' | 'completed',
  ): string | null => {
    const kind = classifyTool(block.name, block.activity);
    if (kind !== 'other' && !hasSpecificToolExecutionTitle(block.name)) {
      const detail = getKeyDetailLine(block.input);
      const title = actionKindRunningLabel(kind, clusterLabels.ing);
      return detail ? `${title.replace(/[…]+$/, '')} · ${detail}` : title;
    }
    return getToolExecutionTitle(
      block.name,
      block.input,
      state,
      stepLabels.toolActivity,
      friendlyTitleLabels,
      block.activity,
    );
  }, [friendlyTitleLabels, stepLabels.toolActivity, clusterLabels.ing]);

  const streamingHeaderText = useMemo(() => {
    if (!anyActive) return null;
    return buildStepsRoundStreamingSummary(
      activityBlocks,
      clusterLabels.ing,
      (block) => semanticTitle(block, 'running'),
    );
  }, [anyActive, activityBlocks, clusterLabels, semanticTitle]);

  if (stepCount === 0 && !anyActive) {
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
    rawThinking: stepLabels.rawThinking,
    toolError: stepLabels.toolError,
    toolActivity: stepLabels.toolActivity,
    runningActions: clusterLabels.ing,
    memoryActivity: stepLabels.memoryActivity,
  };

  const headerMain = anyActive ? (
    <>
      <span className="[overflow-wrap:anywhere]">
        {streamingHeaderText ?? stepLabels.workLogRunning}
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
    <span className="[overflow-wrap:anywhere]">
      {workLog.status === 'failed'
        ? stepLabels.workLogFailed
        : workLog.status === 'partial'
          ? stepLabels.workLogPartial
          : completedDurationMs == null ? stepLabels.workLogTitle : stepLabels.workLogComplete}
    </span>
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

  const showDisclosure = !workLog.compact && stepCount > 0;
  const Header = showDisclosure ? 'button' : 'div';

  return (
    <div
      className={cn(
        'my-1 min-w-0',
        expanded ? 'w-full' : 'w-fit max-w-full',
      )}
    >
      {anyActive || showDisclosure ? <Header
        type={showDisclosure ? "button" : undefined}
        className={cn(
          'flex min-h-11 w-fit max-w-full min-w-0 items-center gap-2 rounded-lg px-1 py-1.5 text-left text-sm text-fg-muted',
          'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent focus-visible:ring-offset-2 focus-visible:ring-offset-surface-panel',
        )}
        onClick={showDisclosure ? () => setUserExpanded((current) => !(current ?? stepsDrawerOpen)) : undefined}
        aria-expanded={showDisclosure ? expanded : undefined}
      >
        <div className="min-w-0 flex-1">
          <span className="inline-flex max-w-full flex-wrap items-baseline">
            {headerMain}
          </span>
        </div>
        <span className="flex shrink-0 items-start justify-end">{headerDurationRight}</span>
        {showDisclosure ? <ChevronDown
          className={cn('size-4 shrink-0 text-fg-muted transition-transform motion-reduce:transition-none', expanded && 'rotate-180')}
          aria-hidden
        /> : null}
      </Header> : null}
      {workLog.items.filter((item): item is ToolUseContent => item.type === 'tool_use').map((block) => (
        <StepRow key={block.id} block={block} toolLabels={toolLabels} stepLabels={timelineLabels}
          cardLabels={cardLabels} conversationId={conversationId} workflowOptions={workflowOptions} surfaceOnly />
      ))}
      {expanded ? (
        <div className="mt-1 w-full min-w-0 pb-1 pl-1">
          <AssistantStepsTimeline
            blocks={visibleItems}
            toolLabels={toolLabels}
            stepLabels={timelineLabels}
            cardLabels={cardLabels}
            conversationId={conversationId}
            workflowOptions={workflowOptions}
            className="assistant-steps-scroll max-h-[min(60vh,28rem)] overflow-y-auto pr-1 [scrollbar-gutter:stable]"
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
  conversationId,
  workflowOptions,
}: {
  blocks: AssistantWorkLogItem[];
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
    rawThinking: string;
    toolError: string;
    toolActivity: ToolExecutionLabels;
    runningActions: StepsClusterIngLabels;
    memoryActivity: MemoryActivityLabels;
  };
  cardLabels: ToolCardLabels;
  className?: string;
  conversationId?: string | null;
  workflowOptions: AssistantActivityWorkflowOptions;
}) {
  const scrollRegionRef = useRef<HTMLDivElement>(null);
  const hasBlocks = blocks.length > 0;

  useEffect(() => {
    const scrollRegion = scrollRegionRef.current;
    if (!scrollRegion) return;

    const handleWheel = (event: WheelEvent) => {
      routeWheelThroughVerticalScrollChain(event, scrollRegion);
    };
    scrollRegion.addEventListener('wheel', handleWheel, { passive: false });
    return () => scrollRegion.removeEventListener('wheel', handleWheel);
  }, [hasBlocks]);

  if (!hasBlocks) {
    return null;
  }

  return (
    <div
      ref={scrollRegionRef}
      className={cn('min-w-0 overflow-x-hidden', className)}
    >
      <div className="min-w-0 space-y-2.5 pl-1">
        {blocks.map((b, i) => (
          <StepRow
            key={b.type === 'tool_use'
              ? b.id
              : b.type === 'text'
                ? b.segmentId ?? `narration-${i}`
                : `thinking-${i}`}
            block={b}
            toolLabels={toolLabels}
            stepLabels={stepLabels}
            cardLabels={cardLabels}
            conversationId={conversationId}
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

const FAILURE_SUMMARY_MAX = 240;

function compactFailureSummary(value: string): string {
  const line = value
    .split('\n')
    .map((part) => part.trim())
    .find(Boolean) ?? '';
  if (line.length <= FAILURE_SUMMARY_MAX) return line;
  return `${line.slice(0, FAILURE_SUMMARY_MAX)}…`;
}

function toolFailureSummary(
  block: ToolUseContent,
  fallback: string,
  cardLabels: ToolCardLabels,
): string {
  const parsed = parseToolResult(block.result);
  const liveDetails = block.details && typeof block.details === 'object' && !Array.isArray(block.details)
    ? block.details as Record<string, unknown>
    : null;
  const details = liveDetails ?? parsed.details;
  if (details?.timedOut === true) return cardLabels.timedOut;
  if (typeof details?.exitCode === 'number' && details.exitCode !== 0) {
    return cardLabels.exitCodeNonZero.replace(/\{\{code\}\}/g, String(details.exitCode));
  }
  for (const key of ['errorMessage', 'error', 'message', 'reason'] as const) {
    const value = details?.[key];
    if (typeof value === 'string' && value.trim()) return compactFailureSummary(value);
  }
  return compactFailureSummary(parsed.text) || fallback;
}

function StepRow({
  block,
  toolLabels,
  stepLabels,
  cardLabels,
  conversationId,
  workflowOptions,
  surfaceOnly = false,
}: {
  surfaceOnly?: boolean;
  block: AssistantWorkLogItem;
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
    rawThinking: string;
    toolError: string;
    toolActivity: ToolExecutionLabels;
    runningActions: StepsClusterIngLabels;
    memoryActivity: MemoryActivityLabels;
  };
  cardLabels: ToolCardLabels;
  conversationId?: string | null;
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

  const browserSetup = useMemo(() => {
    if (block.type !== 'tool_use' || block.status === 'running') return null;
    if (block.name !== 'browser_use') return null;
    return parseBrowserSetupRequired(block.details);
  }, [block]);
  const browserApproval = useMemo(() => {
    if (block.type !== 'tool_use' || block.status === 'running' || block.name !== 'browser_use') return null;
    return parseBrowserApproval(block.details);
  }, [block]);

  if (block.type === 'text') {
    const text = block.text.trim();
    if (!text) return null;
    return (
      <div className="min-w-0 text-sm leading-relaxed text-fg-muted">
        <MarkdownView content={text} compact />
      </div>
    );
  }

  if (block.type === 'thinking') {
    const streaming = Boolean(block.streaming);
    const text = block.text?.trim() ?? '';
    if (!showRawToolData || !text) return null;

    return (
      <div className="min-w-0">
        <div className="min-w-0 space-y-1">
          <span className="inline-flex max-w-full min-w-0 break-words text-sm text-fg-muted [overflow-wrap:anywhere]">
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
    if (!surfaceOnly) return null;
    return (
      <WorkflowCard
        block={block}
        startedAt={block.startedAt}
        conversationId={conversationId}
        labels={workflowOptions.labels}
      />
    );
  }

  const isStreaming = block.status === 'running' || block.activity?.status === 'running';
  const isError = block.status === 'error' || block.activity?.status === 'failed';
  const failureSummary = isError
    ? toolFailureSummary(block, stepLabels.toolError, cardLabels)
    : '';
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

  const friendlyLabels = {
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
  };
  const statefulTitle = kind === 'other' || hasSpecificToolExecutionTitle(block.name);
  const title = isError ? stepLabels.toolError : memoryActivity?.title
    ?? (isStreaming && !statefulTitle
      ? actionKindRunningLabel(kind, stepLabels.runningActions)
      : getToolExecutionTitle(
          block.name,
          block.input,
          isStreaming ? 'running' : 'completed',
          stepLabels.toolActivity,
          friendlyLabels,
          block.activity,
        ));
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

  if (surfaceOnly) {
    return <>
      {!isStreaming && !isError && (kind === 'writeFile' || kind === 'editFile') ? card : null}
      {!isStreaming && !isError ? <ToolUseWidgetSlot toolName={block.name} toolResult={block.result} /> : null}
      {!isStreaming && browserSetup ? <BrowserSetupRequiredCard payload={browserSetup} /> : null}
      {!isStreaming && browserApproval ? <BrowserApprovalCard key={browserApproval.id} approval={browserApproval} conversationId={conversationId} /> : null}
    </>;
  }

  // Raw payloads are a developer inspection surface, never a user-facing fallback renderer.
  const showRawDetails = !isStreaming && showRawToolData;

  return (
    <div className="min-w-0">
      <div className="min-w-0 space-y-1.5">
        <div className="flex min-w-0 flex-wrap items-baseline gap-x-2 gap-y-1">
          <span className="inline-flex max-w-full min-w-0 break-words text-sm text-fg-muted [overflow-wrap:anywhere]">
            {title}
          </span>
        </div>
        {(kind !== 'writeFile' && kind !== 'editFile') || isStreaming || isError ? card : null}
        {memoryActivity ? (
          <div className="space-y-1 text-xs text-fg-muted">
            <p>{memoryActivity.purpose}</p>
            <div className="flex flex-wrap gap-x-3 gap-y-1">
              <Link className="font-medium text-accent-fg hover:underline" to="/user-model">
                {stepLabels.memoryActivity.manage}
              </Link>
              <Link className="font-medium text-accent-fg hover:underline" to="/user-model">
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
        {failureSummary ? (
          <p className="text-xs leading-relaxed text-fg-subtle">
            {failureSummary}
          </p>
        ) : null}
        {!hasCard && detailLine ? (
          <p className="min-w-0 break-words text-xs text-fg-muted [overflow-wrap:anywhere]">
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
      </div>
    </div>
  );
}
