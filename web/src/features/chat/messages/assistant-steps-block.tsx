import { memo, useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { BookOpen, ChevronDown, Circle, FilePenLine, Globe, Search, Sparkles, TriangleAlert } from 'lucide-react';
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
import { knownPartRenderKey } from '@/features/chat/rendering/part-identity';
import { useChatContentPart } from '@/features/chat/rendering/use-chat-render-state';
import { routeWheelThroughVerticalScrollChain } from '@/features/chat/scroll/wheel-scroll-chain';
import { formatParamsJson, getKeyDetailLine } from '@/features/chat/messages/tool-input-preview';
import {
  getPublicToolExecutionTitle,
  hasSpecificToolExecutionTitle,
  type ToolExecutionLabels,
} from '@/features/chat/messages/tool-friendly-title';
import {
  classifyTool,
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
import { SearchDetailsCard } from '@/features/chat/tool-results/search-details-card';
import { parseToolResult } from '@/features/chat/tool-results/parse-tool-result';
import { useDevViewStore } from '@/stores/dev-view-store';
import { formatStepRoundDuration } from '@/features/chat/time/step-round-duration';
import { ExtensionChatWidget } from '@/features/extensions/extension-chat-widget';
import { useUiExtensions } from '@/features/extensions/extension-provider';
import { useChatWidgetMatch } from '@/features/extensions/use-chat-widget-match';
import { cn } from '@/lib/cn';
import type { StoredLanguage } from '@/lib/storage';
import { useLocaleStore } from '@/stores/locale-store';
import { messages } from '@/i18n/messages';
import { groupAssistantActivity, publicAssistantProgress, summarizeToolActivity } from './assistant-activity-groups';
import { CodemodeOutputLink } from './codemode-output-link';
import { codemodeOutputPath } from './codemode-output-path';

function activityItemKey(block: AssistantWorkLogItem, index = 0): string {
  return knownPartRenderKey(block) ?? (block.type === 'tool_use' ? block.id
    : block.type === 'text' ? block.segmentId ?? `narration-${index}` : `thinking-${index}`);
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
  return <span className={className} aria-hidden={active || undefined}>{text}</span>;
});

/** One turn-level disclosure for narration, reasoning summaries, and tool execution. */
export function AssistantStepsBlock({
  workLog,
  pendingStatus,
  toolLabels,
  stepLabels,
  clusterLabels,
  cardLabels,
  conversationId,
  simplified = true,
  personal = false,
  answerStarted = false,
  showThinking = false,
  surfacesOnly = false,
}: {
  surfacesOnly?: boolean;
  showThinking?: boolean;
  simplified?: boolean;
  personal?: boolean;
  answerStarted?: boolean;
  workLog: AssistantTurnWorkLogPresentation;
  pendingStatus?: 'sending' | 'waiting';
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
}) {
  const language = useLocaleStore((s) => s.language);
  const [waitingLong, setWaitingLong] = useState(false);
  useEffect(() => {
    setWaitingLong(false);
    if (pendingStatus !== 'waiting') return;
    const id = window.setTimeout(() => setWaitingLong(true), 3000);
    return () => window.clearTimeout(id);
  }, [pendingStatus]);
  const chatLabels = messages(language).chat;
  const showRawToolData = useDevViewStore((s) => s.showRawToolData);
  const visibleItems = useMemo(() => workLog.items.filter((item) => (
    item.type !== 'thinking' || showRawToolData || showThinking
  )), [workLog.items, showRawToolData, showThinking]);
  const activityBlocks = useMemo(
    () => workLog.items.filter(
      (item): item is ThinkingContent | ToolUseContent => item.type !== 'text',
    ),
    [workLog.items],
  );
  const stepCount = visibleItems.length;
  const anyActive = workLog.active;
  const stepsDrawerOpen = workLog.expandedByDefault && anyActive;
  const [expansion, setExpansion] = useState<{ active: boolean; value: boolean } | null>(null);
  const userExpanded = expansion?.active === anyActive ? expansion.value : null;
  const autoExpanded = stepsDrawerOpen;
  const [showEarlier, setShowEarlier] = useState(false);
  const processRef = useRef<HTMLDivElement>(null);
  const [readingSelection, setReadingSelection] = useState(false);
  const [hasOpened, setHasOpened] = useState(false);
  useEffect(() => {
    if (!anyActive && !readingSelection) return;
    const updateSelection = () => {
      const selection = window.getSelection();
      setReadingSelection(Boolean(selection && !selection.isCollapsed
        && processRef.current?.contains(selection.anchorNode)));
    };
    document.addEventListener('selectionchange', updateSelection);
    return () => document.removeEventListener('selectionchange', updateSelection);
  }, [anyActive, readingSelection]);

  const expanded = !workLog.compact && visibleItems.length > 0 && (userExpanded ?? (autoExpanded || readingSelection));
  useEffect(() => {
    const element = processRef.current;
    if (!expanded || !element) return;
    const onWheel = (event: WheelEvent) => routeWheelThroughVerticalScrollChain(event, element);
    element.addEventListener('wheel', onWheel, { passive: false });
    return () => element.removeEventListener('wheel', onWheel);
  }, [expanded]);
  useEffect(() => {
    if (expanded) { setHasOpened(true); return; }
    if (!hasOpened) return;
    const timer = window.setTimeout(() => setHasOpened(false), 200);
    return () => window.clearTimeout(timer);
  }, [expanded, hasOpened]);
  const stableItems = visibleItems.every(item => knownPartRenderKey(item)
    || item.type === 'tool_use' || (item.type === 'text' && item.segmentId));
  const groups = groupAssistantActivity(visibleItems);
  const recentStart = stableItems && anyActive && !showEarlier && !showRawToolData ? Math.max(0, groups.length - 3) : 0;
  const timelineItems = groups.slice(recentStart).flatMap(group => group.type === 'tools' ? group.tools : [group.item]);
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
  ): string => getPublicToolExecutionTitle(block, state, stepLabels.toolActivity,
    friendlyTitleLabels, clusterLabels.ing),
  [friendlyTitleLabels, stepLabels.toolActivity, clusterLabels.ing]);

  const streamingHeaderText = useMemo(() => {
    if (!anyActive) return null;
    const runningCount = activityBlocks.filter(block => block.type === 'tool_use'
      && (block.status === 'running' || block.activity?.status === 'running')).length;
    if (runningCount > 1) return chatLabels.activityParallel.replace('{{count}}', String(runningCount));
    return buildStepsRoundStreamingSummary(
      activityBlocks,
      clusterLabels.ing,
      (block) => semanticTitle(block, 'running'),
    );
  }, [anyActive, activityBlocks, clusterLabels, semanticTitle, chatLabels.activityParallel]);
  const pendingLabel = pendingStatus === 'sending' ? chatLabels.sendingLabel
    : pendingStatus === 'waiting' ? (waitingLong ? chatLabels.waitingLongLabel : chatLabels.waitingLabel) : null;
  const fallbackLabel = activityBlocks.some((block) => block.type === 'thinking' && block.streaming)
    ? chatLabels.thinkingLabel : stepLabels.workLogRunning;
  const statusPhase = pendingStatus ?? (activityBlocks.some((block) => block.type === 'tool_use' && block.status === 'running')
    ? 'tool' : activityBlocks.some((block) => block.type === 'thinking' && block.streaming)
      ? 'thinking' : activityBlocks.length > 0 ? 'organizing' : 'working');
  const activeHeaderLabel = streamingHeaderText ?? pendingLabel ?? fallbackLabel;
  const completedTools = activityBlocks.filter((block): block is ToolUseContent => block.type === 'tool_use');
  const completedSummary = showThinking && completedTools.length > 0
    ? summarizeToolActivity(completedTools, block => semanticTitle(block, 'completed'), {
      repeated: chatLabels.activityRepeated, more: chatLabels.activityMore, failed: chatLabels.activityFailed,
      separator: language === 'zh' ? '、' : ', ',
    }) : showThinking ? stepLabels.thoughts : null;

  if (workLog.items.length === 0 && !anyActive) {
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

  if (personal || surfacesOnly) {
    return <>
      {workLog.items.filter((item): item is ToolUseContent => item.type === 'tool_use').map((block) => (
        <StepRow key={block.id} block={block} toolLabels={toolLabels} stepLabels={timelineLabels}
          cardLabels={cardLabels} conversationId={conversationId} surfaceOnly runActive={anyActive} />
      ))}
    </>;
  }

  const headerMain = anyActive ? (
    <>
      <span
        className="block min-w-0 flex-1 truncate whitespace-nowrap"
        data-status-phase={statusPhase}
        role="status"
        aria-live="polite"
        aria-atomic="true"
      >
        <span className="assistant-activity-shimmer inline-block max-w-full truncate align-bottom">
          {activeHeaderLabel}
        </span>
      </span>
      <StepRoundDurationText
        active={anyActive}
        startedAt={effectiveStartedAt}
        frozenMs={null}
        language={language}
        className="ml-1.5 w-[8ch] shrink-0 whitespace-nowrap text-right tabular-nums text-fg-muted"
      />
    </>
  ) : (
    <span className="[overflow-wrap:anywhere]">
      {completedSummary ?? (workLog.status === 'failed'
        ? stepLabels.workLogFailed
        : workLog.status === 'partial'
          ? stepLabels.workLogPartial
          : completedDurationMs == null ? stepLabels.workLogTitle : stepLabels.workLogComplete)}
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

  if (simplified && !showRawToolData) {
    const failedWithoutAnswer = !anyActive && !answerStarted && workLog.items.some(item => item.type === 'tool_use'
      && (item.status === 'error' || item.activity?.status === 'failed'));
    const needsAttention = workLog.status === 'failed' || workLog.status === 'partial' || failedWithoutAnswer;
    const progress = (anyActive && !answerStarted) || needsAttention
      ? publicAssistantProgress(workLog.items, block => {
        if (block.status === 'error' || block.activity?.status === 'failed') return null;
        if (!hasSpecificToolExecutionTitle(block.name) && classifyTool(block.name, block.activity) === 'other') return null;
        return semanticTitle(block, anyActive && (block.status === 'running' || block.activity?.status === 'running')
          ? 'running' : 'completed');
      }) : [];
    return (
      <div data-assistant-work-log data-work-log-status={workLog.status} className="my-1 min-w-0 w-full text-left">
        {workLog.items.filter((item): item is ToolUseContent => item.type === 'tool_use').map((block) => (
          <StepRow key={block.id} block={block} toolLabels={toolLabels} stepLabels={timelineLabels}
            cardLabels={cardLabels} conversationId={conversationId} surfaceOnly runActive={anyActive} />
        ))}
        {progress.length > 0 ? <div data-assistant-activity-flow className="space-y-2.5 text-sm leading-relaxed text-fg-muted">
          {progress.map((block, index) => (
            <StepRow key={activityItemKey(block, index)} block={block} toolLabels={toolLabels}
              stepLabels={timelineLabels} cardLabels={cardLabels} conversationId={conversationId} runActive={anyActive} />
          ))}
        </div> : null}
        {anyActive ? <div className="mt-2 flex h-11 w-full min-w-0 items-center gap-2 px-1 text-sm text-fg-muted"
          data-assistant-running>
          <Sparkles className="assistant-activity-busy size-4 shrink-0" aria-hidden />
          <div className="flex h-6 min-w-0 flex-1 items-center">{headerMain}</div>
        </div> : needsAttention ? <p className="text-sm text-fg-muted">
          {failedWithoutAnswer || workLog.status === 'failed' ? stepLabels.workLogFailed : stepLabels.workLogPartial}
        </p> : null}
      </div>
    );
  }

  return (
    <div
      data-assistant-work-log
      data-work-log-status={workLog.status}
      className={cn(
        'my-1 min-w-0',
        anyActive || expanded ? 'w-full' : 'w-fit max-w-full',
      )}
    >
      {anyActive || (!workLog.compact && workLog.items.length > 0) ? <button
        type="button"
        disabled={!showDisclosure}
        className={cn(
          'flex max-w-full min-w-0 items-center gap-2 rounded-lg px-1 py-1.5 text-left text-sm text-fg-muted',
          anyActive ? 'h-11' : 'min-h-11',
          anyActive ? 'w-full' : 'w-fit',
          'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent focus-visible:ring-offset-2 focus-visible:ring-offset-surface-panel',
        )}
        onClick={showDisclosure ? () => setExpansion({ active: anyActive, value: !expanded }) : undefined}
        aria-expanded={showDisclosure ? expanded : undefined}
      >
        <Sparkles className={cn('size-4 shrink-0', anyActive && 'assistant-activity-busy')} aria-hidden />
        <div className="min-w-0 flex-1 overflow-hidden">
          <span className="flex h-6 w-full min-w-0 items-center">
            {headerMain}
          </span>
        </div>
        <span className="flex shrink-0 items-start justify-end">{headerDurationRight}</span>
        {showDisclosure ? <ChevronDown
          className={cn('size-4 shrink-0 text-fg-muted transition-transform motion-reduce:transition-none', expanded && 'rotate-180')}
          aria-hidden
        /> : null}
      </button> : null}
      {workLog.items.filter((item): item is ToolUseContent => item.type === 'tool_use').map((block) => (
        <StepRow key={block.id} block={block} toolLabels={toolLabels} stepLabels={timelineLabels}
          cardLabels={cardLabels} conversationId={conversationId}surfaceOnly runActive={anyActive} />
      ))}
      {expanded || hasOpened ? (
        <div className="assistant-activity-disclosure" data-open={expanded} aria-hidden={!expanded} inert={!expanded}>
          <div className="min-h-0 overflow-hidden">
            <div ref={processRef} className="assistant-activity-flow mt-1 max-h-[min(32rem,50dvh)] w-full min-w-0 overflow-x-hidden overflow-y-auto pb-1 pl-1 pr-2 [scrollbar-gutter:stable]" data-assistant-activity-flow
              onFocusCapture={() => setExpansion({ active: anyActive, value: true })}>
              {recentStart > 0 ? <button type="button" className="mb-3 text-xs text-fg-muted hover:text-fg"
                onClick={() => setShowEarlier(true)}>{chatLabels.activityEarlier}</button> : null}
              <AssistantStepsTimeline
                blocks={timelineItems}
                toolLabels={toolLabels}
                stepLabels={timelineLabels}
                cardLabels={cardLabels}
                conversationId={conversationId}
                animateNew={anyActive && expanded && !showEarlier}
                runActive={anyActive}
                showThinking={showThinking}
              />
            </div>
          </div>
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
  animateNew = false,
  runActive,
  showThinking = false,
}: {
  showThinking?: boolean;
  animateNew?: boolean;
  runActive?: boolean;
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
}) {
  const initialKeys = useRef(new Set(blocks.map(activityItemKey)));
  const showRawToolData = useDevViewStore(state => state.showRawToolData);
  const language = useLocaleStore(state => state.language);
  const groups = showRawToolData
    ? blocks.map(item => ({ type: 'item' as const, item }))
    : groupAssistantActivity(blocks);
  const hasBlocks = blocks.length > 0;

  if (!hasBlocks) {
    return null;
  }

  return (
    <div
      className={cn('min-w-0 overflow-x-hidden', className)}
    >
      <div className="min-w-0 space-y-2.5 pl-1">
        {groups.map((group, i) => {
          const first = group.type === 'tools' ? group.tools[0] : group.item;
          const key = activityItemKey(first, i);
          const renderTool = (block: ToolUseContent) => (
            <StepRow key={block.id} block={block} toolLabels={toolLabels} stepLabels={stepLabels}
              cardLabels={cardLabels} conversationId={conversationId} runActive={runActive} />
          );
          return (
            <div key={key} className={cn(animateNew && !initialKeys.current.has(key) && first.type !== 'text' && 'assistant-activity-enter')}>
              {group.type === 'tools' ? (
                <ToolActivityGroup tools={group.tools} runActive={runActive} labels={stepLabels}
                  language={language} renderTool={renderTool} />
              ) : (
                group.item.type === 'thinking' && showThinking && !showRawToolData ? (
                  <div data-assistant-thinking className="text-sm leading-relaxed text-fg-muted">
                    <MarkdownView content={group.item.text} compact streaming={Boolean(runActive && group.item.streaming)} />
                  </div>
                ) : <StepRow block={group.item} toolLabels={toolLabels} stepLabels={stepLabels}
                  cardLabels={cardLabels} conversationId={conversationId} runActive={runActive} />
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
}

function ToolActivityGroup({ tools, runActive, labels, language, renderTool }: {
  tools: ToolUseContent[];
  runActive?: boolean;
  labels: Parameters<typeof AssistantStepsTimeline>[0]['stepLabels'];
  language: StoredLanguage;
  renderTool: (tool: ToolUseContent) => ReactNode;
}) {
  const running = runActive && tools.some(tool => tool.status === 'running' || tool.activity?.status === 'running');
  const chat = messages(language).chat;
  const summary = summarizeToolActivity(tools, tool => getPublicToolExecutionTitle(tool,
    runActive && (tool.status === 'running' || tool.activity?.status === 'running') ? 'running' : 'completed',
    labels.toolActivity, labels, labels.runningActions), {
    repeated: chat.activityRepeated, more: chat.activityMore, failed: chat.activityFailed,
    separator: language === 'zh' ? '、' : ', ',
  });
  const activeTool = running ? [...tools].reverse().find(tool => tool.status === 'running' || tool.activity?.status === 'running') : undefined;
  if (tools.length === 1) return renderTool(tools[0]);
  return (
    <div data-activity-group className="min-w-0 space-y-1.5">
      {activeTool ? renderTool(activeTool) : null}
      <details className="min-w-0 text-[13px] text-fg-muted">
        <summary className="cursor-pointer rounded-md py-1 hover:text-fg focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent">
          <span>{summary}</span>
        </summary>
        <div className="mt-2 min-w-0 space-y-2.5 border-l border-edge-subtle pl-3">
          {tools.filter(tool => tool !== activeTool).map(renderTool)}
        </div>
      </details>
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
  block: snapshotBlock,
  toolLabels,
  stepLabels,
  cardLabels,
  conversationId,
  surfaceOnly = false,
  runActive = true,
}: {
  surfaceOnly?: boolean;
  runActive?: boolean;
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
}) {
  const currentPart = useChatContentPart(conversationId, knownPartRenderKey(snapshotBlock));
  const block = currentPart?.type === snapshotBlock.type ? currentPart : snapshotBlock;
  const showRawToolData = useDevViewStore((s) => s.showRawToolData);
  const outputLanguage = useLocaleStore(state => state.language);
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

  if (block.type === 'text') {
    const text = block.text.trim();
    if (!text) return null;
    return (
      <div className="min-w-0 text-sm leading-relaxed text-fg-muted">
        <MarkdownView content={text} compact streaming={block.presentation === 'pending'} />
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
          <span className="inline-flex max-w-full min-w-0 break-words text-[13px] text-fg-muted [overflow-wrap:anywhere]">
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



  const isStreaming = runActive && (block.status === 'running' || block.activity?.status === 'running');
  const isError = block.status === 'error' || block.activity?.status === 'failed';
  const failureSummary = isError
    ? toolFailureSummary(block, stepLabels.toolError, cardLabels)
    : '';
  const resultText = toolResultText;
  const retainedOutput = block.name === 'codemode' ? codemodeOutputPath(resultText ?? '') : undefined;
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

  const title = isError ? stepLabels.toolError : memoryActivity?.title
    ?? getPublicToolExecutionTitle(block, isStreaming ? 'running' : 'completed',
      stepLabels.toolActivity, friendlyLabels, stepLabels.runningActions);
  const Icon = isError ? TriangleAlert : kind.includes('Search') || kind === 'search' ? Search
    : kind === 'readFile' ? BookOpen : kind === 'editFile' || kind === 'writeFile' ? FilePenLine
      : kind === 'fetchUrl' || kind === 'openUrl' ? Globe : Circle;

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
      {!isStreaming && !isError ? <ToolUseWidgetSlot toolName={block.name} toolResult={block.result} /> : null}
    </>;
  }

  // Raw payloads are a developer inspection surface, never a user-facing fallback renderer.
  const showRawDetails = !isStreaming && showRawToolData;

  return (
    <div className={block.parentToolCallId ? 'ml-4 min-w-0 border-l border-edge pl-3' : 'min-w-0'}>
      <div className="min-w-0 space-y-1.5">
        <div className="flex min-w-0 items-start gap-2" data-activity-status={isError ? 'failed' : isStreaming ? 'running' : 'completed'}>
          <Icon className={cn('mt-0.5 size-4 shrink-0 text-fg-subtle', isStreaming && 'assistant-activity-busy')} aria-hidden />
          <span className="inline-flex max-w-full min-w-0 break-words text-[13px] text-fg-muted [overflow-wrap:anywhere]">
            {title}
          </span>
        </div>
        {card ? <details className="min-w-0 text-xs text-fg-muted"><summary className="cursor-pointer hover:text-fg">{stepLabels.stepDetails}</summary>{card}</details> : null}
        {kind === 'webSearch' && !isStreaming ? <SearchDetailsCard block={block} summary={stepLabels.stepDetails}
          labels={messages(outputLanguage).chat.searchDetails} developer={showRawToolData} language={outputLanguage} /> : null}
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
        {failureSummary && showRawToolData ? (
          <p className="text-xs leading-relaxed text-fg-subtle">
            {failureSummary}
          </p>
        ) : null}
        {showRawToolData && !hasCard && detailLine ? (
          <p className="min-w-0 break-words text-xs text-fg-muted [overflow-wrap:anywhere]">
            {detailLine}
          </p>
        ) : null}
        {showRawToolData && liveOutputText ? (
          <pre className="max-h-48 min-w-0 overflow-y-auto overflow-x-hidden rounded-md bg-surface-hover/60 p-2 whitespace-pre-wrap break-words font-mono text-xs leading-relaxed text-fg-muted [overflow-wrap:anywhere] dark:bg-surface-hover/35">
            {liveOutputText}
          </pre>
        ) : null}
        {retainedOutput ? <CodemodeOutputLink path={retainedOutput} conversationId={conversationId}
          label={outputLanguage === 'zh' ? '查看完整输出' : 'View full output'} /> : null}
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
