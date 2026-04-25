import { useEffect, useMemo, useRef, useState } from 'react';
import { CheckCircle2, ChevronDown, Loader2, XCircle } from 'lucide-react';

import type {
  Message,
  ProgressState,
  ThinkingContent,
  ToolUseContent,
} from '@/features/chat/messages.types';
import { formatStepRoundDuration } from '@/features/chat/step-round-duration';
import { ToolResultFileLinks } from '@/features/chat/tool-result-file-links';
import { extractFilePathsFromToolResult } from '@/features/chat/tool-result-file-paths';
import {
  extractWebSearchLinksFromToolResult,
  isWebSearchToolName,
  WebSearchToolResultLinks,
} from '@/features/chat/web-search-tool-result-links';
import { ExtensionChatWidget } from '@/features/extensions/extension-chat-widget';
import { useUiExtensions } from '@/features/extensions/extension-provider';
import { useChatWidgetMatch } from '@/features/extensions/use-chat-widget-match';
import { cn } from '@/lib/cn';
import { interaction } from '@/lib/interaction';
import { useLocaleStore } from '@/stores/locale-store';

const STEPS_ADVANCED_STORAGE_KEY = 'xopc.chat.steps.advanced';

function readStepsAdvancedPreference(): boolean {
  try {
    return globalThis.localStorage?.getItem(STEPS_ADVANCED_STORAGE_KEY) === '1';
  } catch {
    return false;
  }
}

function writeStepsAdvancedPreference(next: boolean): void {
  try {
    globalThis.localStorage?.setItem(STEPS_ADVANCED_STORAGE_KEY, next ? '1' : '0');
  } catch {
    /* ignore */
  }
}

function formatParamsJson(params: unknown): string {
  if (params === undefined) return '';
  try {
    return JSON.stringify(JSON.parse(params as string), null, 2);
  } catch {
    try {
      return JSON.stringify(params, null, 2);
    } catch {
      return String(params);
    }
  }
}

function extractSearchQuery(input: unknown): string {
  if (input == null) return '';
  let obj: Record<string, unknown> | null = null;
  try {
    obj =
      typeof input === 'string'
        ? (JSON.parse(input) as Record<string, unknown>)
        : (input as Record<string, unknown>);
  } catch {
    return '';
  }
  const q = obj?.query ?? obj?.q ?? obj?.query_string ?? obj?.search_term ?? obj?.searchQuery;
  if (typeof q === 'string') return q;
  if (typeof q === 'number') return String(q);
  return '';
}

function extractPathPreview(input: unknown): string {
  if (input == null) return '';
  let obj: Record<string, unknown> | null = null;
  try {
    obj =
      typeof input === 'string'
        ? (JSON.parse(input) as Record<string, unknown>)
        : (input as Record<string, unknown>);
  } catch {
    return '';
  }
  const p = obj?.path ?? obj?.file_path ?? obj?.filepath ?? obj?.file;
  if (typeof p === 'string') return p;
  return '';
}

function extractUrlPreview(input: unknown): string {
  if (input == null) return '';
  let obj: Record<string, unknown> | null = null;
  try {
    obj =
      typeof input === 'string'
        ? (JSON.parse(input) as Record<string, unknown>)
        : (input as Record<string, unknown>);
  } catch {
    return '';
  }
  const u = obj?.url ?? obj?.href ?? obj?.uri ?? obj?.website;
  if (typeof u === 'string') return u;
  return '';
}

function extractCommandPreview(input: unknown): string {
  if (input == null) return '';
  let obj: Record<string, unknown> | null = null;
  try {
    obj =
      typeof input === 'string'
        ? (JSON.parse(input) as Record<string, unknown>)
        : (input as Record<string, unknown>);
  } catch {
    return '';
  }
  const c = obj?.command ?? obj?.cmd ?? obj?.shell ?? obj?.script;
  if (typeof c === 'string') return c;
  return '';
}

/** Human-readable tool label for search/read vs raw tool id (progress line + drawer). */
export function getToolStepDisplayName(
  name: string,
  labels: { searchedWeb: string; readFile: string },
): string {
  const n = name.toLowerCase().replace(/-/g, '_');
  if (n.includes('search') || n === 'web_search' || n === 'brave_search') return labels.searchedWeb;
  if (n.includes('read_file') || n === 'read_file' || n.includes('file_read')) return labels.readFile;
  return name.trim() || 'tool';
}

function toolNameKey(name: string): string {
  return name.toLowerCase().replace(/-/g, '_').trim();
}

function getFriendlyToolTitle(
  name: string,
  labels: {
    searchedWeb: string;
    readFile: string;
    runCommand: string;
    listDirectory: string;
    writeFile: string;
    editFile: string;
    openUrl: string;
    fetchUrl: string;
    unknownTool: string;
  },
): string {
  const n = toolNameKey(name);
  if (n === 'shell') return labels.runCommand;
  if (n === 'list_dir' || n === 'ls') return labels.listDirectory;
  if (n === 'write_file') return labels.writeFile;
  if (n === 'edit_file') return labels.editFile;
  if (n === 'web_fetch') return labels.fetchUrl;
  if (n === 'open_url') return labels.openUrl;
  if (n === 'web_search' || n === 'brave_search' || n.includes('search')) return labels.searchedWeb;
  if (n === 'read_file' || n.includes('read_file') || n.includes('file_read')) return labels.readFile;
  return labels.unknownTool.replace('{{name}}', name.trim() || 'tool');
}

function getKeyDetailLine(input: unknown): string {
  if (input == null) return '';
  let obj: Record<string, unknown> | null = null;
  try {
    obj =
      typeof input === 'string'
        ? (JSON.parse(input) as Record<string, unknown>)
        : (input as Record<string, unknown>);
  } catch {
    // fall back to string input
    return typeof input === 'string' ? input.trim() : '';
  }

  const candidates = [
    obj.command,
    obj.cmd,
    obj.shell,
    obj.script,
    obj.path,
    obj.file_path,
    obj.filepath,
    obj.file,
    obj.url,
    obj.href,
    obj.uri,
    obj.website,
    obj.query,
    obj.q,
    obj.query_string,
    obj.search_term,
    obj.searchQuery,
  ];

  for (const c of candidates) {
    if (typeof c === 'string' && c.trim()) {
      const t = c.trim();
      return t.length > 120 ? `${t.slice(0, 120)}…` : t;
    }
    if (typeof c === 'number' && Number.isFinite(c)) {
      return String(c);
    }
  }
  return '';
}

function filterVisibleSteps(blocks: Array<ThinkingContent | ToolUseContent>): Array<ThinkingContent | ToolUseContent> {
  return blocks.filter(
    (b) =>
      b.type !== 'thinking' ||
      Boolean(b.text?.trim()) ||
      Boolean(b.streaming),
  );
}

function viewStepsLabel(
  count: number,
  m: { viewSteps_one: string; viewSteps_other: string },
): string {
  const key = count === 1 ? m.viewSteps_one : m.viewSteps_other;
  return key.replace(/\{\{count\}\}/g, String(count));
}

/** Collapsible inline block: “View N steps” header + timeline (main chat column). */
export function AssistantStepsBlock({
  blocks,
  toolLabels,
  stepLabels,
  sessionKey,
}: {
  blocks: Array<ThinkingContent | ToolUseContent>;
  toolLabels: { input: string; output: string; noOutput: string };
  stepLabels: {
    thoughts: string;
    thoughtsStreaming: string;
    viewSteps_one: string;
    viewSteps_other: string;
    searchedWeb: string;
    readFile: string;
    stepDetails: string;
    stepsRoundComplete: string;
    advancedModeOn: string;
    advancedModeOff: string;
    runCommand: string;
    listDirectory: string;
    writeFile: string;
    editFile: string;
    openUrl: string;
    fetchUrl: string;
    unknownTool: string;
  };
  sessionKey?: string | null;
}) {
  const language = useLocaleStore((s) => s.language);
  const visibleBlocks = useMemo(() => filterVisibleSteps(blocks), [blocks]);
  const stepCount = visibleBlocks.length;
  const anyActive = visibleBlocks.some(
    (b) =>
      (b.type === 'thinking' && b.streaming) || (b.type === 'tool_use' && b.status === 'running'),
  );

  const roundStartRef = useRef<number | null>(null);
  const prevAnyActiveRef = useRef(false);
  const [frozenDurationMs, setFrozenDurationMs] = useState<number | null>(null);
  const [liveTick, setLiveTick] = useState(0);
  const [expanded, setExpanded] = useState(anyActive);
  const [advanced, setAdvanced] = useState<boolean>(() => readStepsAdvancedPreference());

  if (anyActive && roundStartRef.current === null) {
    roundStartRef.current = Date.now();
  }

  useEffect(() => {
    if (!anyActive) return;
    const id = window.setInterval(() => setLiveTick((n) => n + 1), 500);
    return () => window.clearInterval(id);
  }, [anyActive]);

  useEffect(() => {
    if (anyActive) {
      setExpanded(true);
    } else if (prevAnyActiveRef.current) {
      if (roundStartRef.current !== null) {
        setFrozenDurationMs(Date.now() - roundStartRef.current);
      }
      setExpanded(false);
    }
    prevAnyActiveRef.current = anyActive;
  }, [anyActive]);

  void liveTick;

  if (stepCount === 0) {
    return null;
  }

  const timelineLabels = {
    thoughts: stepLabels.thoughts,
    thoughtsStreaming: stepLabels.thoughtsStreaming,
    searchedWeb: stepLabels.searchedWeb,
    readFile: stepLabels.readFile,
    stepDetails: stepLabels.stepDetails,
    advancedModeOn: stepLabels.advancedModeOn,
    advancedModeOff: stepLabels.advancedModeOff,
    runCommand: stepLabels.runCommand,
    listDirectory: stepLabels.listDirectory,
    writeFile: stepLabels.writeFile,
    editFile: stepLabels.editFile,
    openUrl: stepLabels.openUrl,
    fetchUrl: stepLabels.fetchUrl,
    unknownTool: stepLabels.unknownTool,
  };

  const liveElapsedMs =
    anyActive && roundStartRef.current !== null ? Date.now() - roundStartRef.current : 0;
  const summaryDurationText =
    anyActive && roundStartRef.current !== null
      ? formatStepRoundDuration(liveElapsedMs, language)
      : frozenDurationMs !== null
        ? formatStepRoundDuration(frozenDurationMs, language)
        : null;

  const headerLeadingIcon = anyActive ? (
    <Loader2 className="mt-0.5 h-4 w-4 shrink-0 animate-spin text-accent-fg" aria-hidden />
  ) : (
    <CheckCircle2 className="mt-0.5 h-4 w-4 shrink-0 text-emerald-600 dark:text-emerald-400" aria-hidden />
  );

  const headerMain = anyActive ? (
    <>
      <span className="[overflow-wrap:anywhere]">{viewStepsLabel(stepCount, stepLabels)}</span>
      {summaryDurationText ? (
        <span className="ml-1.5 tabular-nums text-fg-muted">{summaryDurationText}</span>
      ) : null}
    </>
  ) : (
    <>
      <span className="[overflow-wrap:anywhere]">{stepLabels.stepsRoundComplete}</span>
    </>
  );

  const headerDurationRight =
    !anyActive && summaryDurationText ? (
      <span className="mt-0.5 tabular-nums text-xs text-fg-muted">{summaryDurationText}</span>
    ) : null;

  return (
    <div className="my-1 w-full min-w-0 overflow-hidden rounded-xl bg-surface-hover/50 dark:bg-surface-hover/30">
      <button
        type="button"
        className={cn(
          'grid w-full min-w-0 grid-cols-[auto_minmax(0,1fr)_auto_auto_auto] items-start gap-x-2 rounded-t-xl px-3 py-2 text-left',
          interaction.transition,
          'hover:bg-surface-hover/80 dark:hover:bg-surface-hover/50',
          'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent focus-visible:ring-offset-2 focus-visible:ring-offset-surface-panel',
        )}
        onClick={() => setExpanded(!expanded)}
        aria-expanded={expanded}
      >
        {headerLeadingIcon}
        <div className="min-w-0">
          <span className="inline-flex max-w-full flex-wrap items-baseline rounded-md bg-accent-soft/70 px-2 py-0.5 text-xs font-medium text-fg dark:bg-accent-soft/40">
            {headerMain}
          </span>
        </div>
        <span className="flex items-start justify-end">{headerDurationRight}</span>
        <span className="mt-0.5 flex items-center justify-end">
          <button
            type="button"
            className={cn(
              'inline-flex items-center rounded-md border border-edge-subtle bg-surface-panel px-1 py-0.5 text-[11px] font-medium text-fg-muted',
              'hover:bg-surface-hover/60 hover:text-fg',
              interaction.focusRingPanel,
            )}
            onClick={(e) => {
              e.preventDefault();
              e.stopPropagation();
              setAdvanced((cur) => {
                const next = !cur;
                writeStepsAdvancedPreference(next);
                return next;
              });
            }}
            aria-pressed={advanced}
            title={advanced ? stepLabels.advancedModeOn : stepLabels.advancedModeOff}
          >
            {advanced ? stepLabels.advancedModeOn : stepLabels.advancedModeOff}
          </button>
        </span>
        <ChevronDown
          className={cn('mt-0.5 h-4 w-4 shrink-0 text-fg-muted transition-transform', expanded && 'rotate-180')}
          aria-hidden
        />
      </button>
      {expanded ? (
        <div className="border-t border-edge-subtle/90 px-3 pb-3 pt-2 dark:border-edge-subtle">
          <AssistantStepsTimeline
            blocks={blocks}
            toolLabels={toolLabels}
            stepLabels={timelineLabels}
            advanced={advanced}
            sessionKey={sessionKey}
          />
        </div>
      ) : null}
    </div>
  );
}

/** All thinking + tool_use blocks from the message, in order (for the execution drawer). */
export function collectAssistantStepBlocks(message: Message): Array<ThinkingContent | ToolUseContent> {
  const out: Array<ThinkingContent | ToolUseContent> = [];
  for (const b of message.content ?? []) {
    if (b.type === 'thinking' || b.type === 'tool_use') {
      out.push(b);
    }
  }
  if (out.length > 0) return out;
  return [];
}

export function stepBlocksActive(blocks: Array<ThinkingContent | ToolUseContent>): boolean {
  return blocks.some(
    (b) =>
      (b.type === 'thinking' && b.streaming) || (b.type === 'tool_use' && b.status === 'running'),
  );
}

export type ExecutionStepLabels = {
  searchedWeb: string;
  readFile: string;
  thoughtsStreaming: string;
  composerRunningTool: string;
  composerStageThinking: string;
  composerStageSearching: string;
  composerStageReading: string;
  composerStageWriting: string;
  composerStageExecuting: string;
  composerStageAnalyzing: string;
  fallback: string;
};

const THINKING_PREVIEW_MAX = 160;

function truncateThinkingSummary(text: string): string {
  const t = text.replace(/\s+/g, ' ').trim();
  if (!t) return '';
  if (t.length <= THINKING_PREVIEW_MAX) return t;
  return `${t.slice(0, THINKING_PREVIEW_MAX)}…`;
}

function summarizeRunningToolBlock(block: ToolUseContent, labels: ExecutionStepLabels): string {
  const display = getToolStepDisplayName(block.name, labels);
  const q = extractSearchQuery(block.input);
  const path = extractPathPreview(block.input);
  const url = extractUrlPreview(block.input);
  const cmd = extractCommandPreview(block.input);
  const detail = (q || path || url || cmd).trim();
  if (detail) {
    const short = detail.length > 96 ? `${detail.slice(0, 96)}…` : detail;
    return `${display} · ${short}`;
  }
  return labels.composerRunningTool.replace('{{name}}', display);
}

/** Collapses duplicated halves and repeated "🤔 Thinking..." segments from SSE. */
function normalizeProgressMessage(msg: string): string {
  let s = msg.trim();
  s = s.replace(/(?:🤔\s*Thinking\.\.\.(?:\s|$))+/gi, '🤔 Thinking... ');
  s = s.replace(/\s+/g, ' ').trim();
  const half = Math.floor(s.length / 2);
  if (half >= 12 && s.slice(0, half) === s.slice(half)) {
    return normalizeProgressMessage(s.slice(0, half));
  }
  return s;
}

function isGenericProgressMessage(msg: string, labels: ExecutionStepLabels): boolean {
  const stripped = msg.replace(/🤔/gu, '').replace(/\s+/g, ' ').trim();
  if (!stripped) return true;
  const low = stripped.toLowerCase();
  const stageThinking = labels.composerStageThinking.replace(/🤔/gu, '').replace(/\s+/g, ' ').trim().toLowerCase();
  if (stageThinking && low === stageThinking) return true;
  if (low === labels.thoughtsStreaming.toLowerCase()) return true;
  if (/^thinking(?:\.\.\.|\.{1,3})?$/i.test(stripped)) return true;
  if (stripped.length < 48 && /^[\s🤔.!？…]*thinking[\s🤔.!？…]*$/i.test(msg)) return true;
  return false;
}

function progressFromStage(stage: string | undefined, labels: ExecutionStepLabels): string | null {
  const s = stage?.toLowerCase();
  if (s === 'thinking') return labels.composerStageThinking;
  if (s === 'searching') return labels.composerStageSearching;
  if (s === 'reading') return labels.composerStageReading;
  if (s === 'writing') return labels.composerStageWriting;
  if (s === 'executing') return labels.composerStageExecuting;
  if (s === 'analyzing') return labels.composerStageAnalyzing;
  return null;
}

/**
 * Short label for the current in-flight step: real tool/thinking content first; generic SSE
 * placeholders (e.g. "🤔 Thinking...") are skipped in favor of block-derived text.
 */
export function describeCurrentExecutionStep(
  blocks: Array<ThinkingContent | ToolUseContent>,
  progress: ProgressState | null,
  isStreamRow: boolean,
  labels: ExecutionStepLabels,
): string {
  for (let i = blocks.length - 1; i >= 0; i--) {
    const b = blocks[i];
    if (b.type === 'tool_use' && b.status === 'running') {
      return summarizeRunningToolBlock(b, labels);
    }
  }

  for (let i = blocks.length - 1; i >= 0; i--) {
    const b = blocks[i];
    if (b.type === 'thinking' && b.streaming) {
      const preview = truncateThinkingSummary(b.text || '');
      if (preview) return preview;
      break;
    }
  }

  if (isStreamRow && progress) {
    const raw = progress.message?.trim();
    if (raw) {
      const norm = normalizeProgressMessage(raw);
      if (!isGenericProgressMessage(norm, labels)) return norm;
    }
    const tn = progress.toolName?.trim();
    if (tn) {
      const display = getToolStepDisplayName(tn, labels);
      return labels.composerRunningTool.replace('{{name}}', display);
    }
    const fromStage = progressFromStage(progress.stage, labels);
    if (fromStage) return fromStage;
  }

  for (let i = blocks.length - 1; i >= 0; i--) {
    const b = blocks[i];
    if (b.type === 'thinking' && b.streaming) return labels.thoughtsStreaming;
  }

  return labels.fallback;
}

export function AssistantStepsTimeline({
  blocks,
  toolLabels,
  stepLabels,
  advanced,
  className,
  sessionKey,
}: {
  blocks: Array<ThinkingContent | ToolUseContent>;
  toolLabels: { input: string; output: string; noOutput: string };
  stepLabels: {
    thoughts: string;
    thoughtsStreaming: string;
    searchedWeb: string;
    readFile: string;
    stepDetails: string;
    advancedModeOn: string;
    advancedModeOff: string;
    runCommand: string;
    listDirectory: string;
    writeFile: string;
    editFile: string;
    openUrl: string;
    fetchUrl: string;
    unknownTool: string;
  };
  advanced: boolean;
  className?: string;
  sessionKey?: string | null;
}) {
  const visibleBlocks = filterVisibleSteps(blocks);
  if (visibleBlocks.length === 0) {
    return null;
  }

  return (
    <div className={cn('min-w-0 overflow-x-hidden', className)}>
      <div className="ml-1 min-w-0 space-y-3 border-l border-edge-subtle pl-3 dark:border-edge-subtle">
        {visibleBlocks.map((b, i) => (
          <StepRow
            key={b.type === 'tool_use' ? b.id : `thinking-${i}`}
            block={b}
            toolLabels={toolLabels}
            stepLabels={stepLabels}
            advanced={advanced}
            sessionKey={sessionKey}
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

function StepRow({
  block,
  toolLabels,
  stepLabels,
  advanced,
  sessionKey,
}: {
  block: ThinkingContent | ToolUseContent;
  toolLabels: { input: string; output: string; noOutput: string };
  stepLabels: {
    thoughts: string;
    thoughtsStreaming: string;
    searchedWeb: string;
    readFile: string;
    stepDetails: string;
    advancedModeOn: string;
    advancedModeOff: string;
    runCommand: string;
    listDirectory: string;
    writeFile: string;
    editFile: string;
    openUrl: string;
    fetchUrl: string;
    unknownTool: string;
  };
  advanced: boolean;
  sessionKey?: string | null;
}) {
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

  const extractedFilePaths = useMemo(() => {
    if (block.type !== 'tool_use' || block.status === 'running' || block.status === 'error') {
      return [];
    }
    if (!toolResultText) {
      return [];
    }
    return extractFilePathsFromToolResult(toolResultText);
  }, [block, toolResultText]);

  const webSearchLinks = useMemo(() => {
    if (block.type !== 'tool_use' || block.status === 'running' || block.status === 'error') {
      return [];
    }
    if (!isWebSearchToolName(block.name) || !toolResultText) {
      return [];
    }
    return extractWebSearchLinksFromToolResult(toolResultText);
  }, [block, toolResultText]);

  if (block.type === 'thinking') {
    const streaming = Boolean(block.streaming);
    const text = block.text?.trim() ?? '';
    if (!text && !streaming) return null;

    return (
      <div className="flex min-w-0 gap-2.5">
        <div className="mt-0.5 shrink-0">
          {streaming ? (
            <Loader2 className="h-4 w-4 animate-spin text-fg-muted" aria-hidden />
          ) : (
            <CheckCircle2 className="h-4 w-4 text-emerald-600 dark:text-emerald-400" aria-hidden />
          )}
        </div>
        <div className="min-w-0 flex-1 space-y-1">
          <span className="inline-flex max-w-full min-w-0 break-words rounded-md bg-accent-soft/60 px-1.5 py-0.5 text-xs font-medium text-fg [overflow-wrap:anywhere] dark:bg-accent-soft/35">
            {streaming ? stepLabels.thoughtsStreaming : stepLabels.thoughts}
          </span>
          {text ? (
            <p className="line-clamp-4 whitespace-pre-wrap break-words text-xs leading-relaxed text-fg-muted [overflow-wrap:anywhere]">
              {text}
            </p>
          ) : streaming ? (
            <p className="text-xs text-fg-muted">…</p>
          ) : null}
        </div>
      </div>
    );
  }

  const isStreaming = block.status === 'running';
  const isError = block.status === 'error';
  const resultText = toolResultText;

  let outputPreview = resultText ?? '';
  if (outputPreview) {
    try {
      outputPreview = JSON.stringify(JSON.parse(outputPreview), null, 2);
    } catch {
      /* keep */
    }
  }

  const title = getFriendlyToolTitle(block.name, {
    searchedWeb: stepLabels.searchedWeb,
    readFile: stepLabels.readFile,
    runCommand: stepLabels.runCommand,
    listDirectory: stepLabels.listDirectory,
    writeFile: stepLabels.writeFile,
    editFile: stepLabels.editFile,
    openUrl: stepLabels.openUrl,
    fetchUrl: stepLabels.fetchUrl,
    unknownTool: stepLabels.unknownTool,
  });
  const detailLine = getKeyDetailLine(block.input);

  const paramsJson = block.input !== undefined ? formatParamsJson(block.input) : '';

  return (
    <div className="flex min-w-0 gap-2.5">
      <div className="mt-0.5 shrink-0">
        {isStreaming ? (
          <Loader2 className="h-4 w-4 animate-spin text-fg-muted" aria-hidden />
        ) : isError ? (
          <XCircle className="h-4 w-4 text-red-600 dark:text-red-400" aria-hidden />
        ) : (
          <CheckCircle2 className="h-4 w-4 text-emerald-600 dark:text-emerald-400" aria-hidden />
        )}
      </div>
      <div className="min-w-0 flex-1 space-y-1.5">
        <div className="flex min-w-0 flex-wrap items-baseline gap-x-2 gap-y-1">
          <span className="inline-flex max-w-full min-w-0 break-words rounded-md bg-accent-soft/60 px-1.5 py-0.5 text-xs font-medium text-fg [overflow-wrap:anywhere] dark:bg-accent-soft/35">
            {title}
          </span>
          {isStreaming ? (
            <span className="text-xs text-fg-disabled">running…</span>
          ) : isError ? (
            <span className="text-xs text-red-600 dark:text-red-400">error</span>
          ) : null}
        </div>
        {detailLine ? (
          <p className="min-w-0 rounded-md bg-accent-soft/40 px-1.5 py-1 text-xs break-words text-fg-muted [overflow-wrap:anywhere] dark:bg-accent-soft/25">
            {detailLine}
          </p>
        ) : null}
        {!isStreaming && advanced ? (
          <details className="group min-w-0 text-xs">
            <summary className="cursor-pointer select-none text-fg-subtle underline-offset-2 hover:text-fg-muted group-open:text-fg-muted">
              {stepLabels.stepDetails}
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
        {!isStreaming && !isError && webSearchLinks.length > 0 ? (
          <WebSearchToolResultLinks links={webSearchLinks} />
        ) : null}
        {!isStreaming && !isError && extractedFilePaths.length > 0 ? (
          <ToolResultFileLinks paths={extractedFilePaths} sessionKey={sessionKey} />
        ) : null}
      </div>
    </div>
  );
}
