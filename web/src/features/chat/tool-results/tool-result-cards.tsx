// Structured, human-readable cards rendered inside an assistant tool step,
// replacing the raw JSON `<details>` panel for known tool kinds. Each card
// receives the live `ToolUseContent` block plus a flat `labels` bag of i18n
// strings so it can be unit-tested without an i18n provider.
//
// Layout convention per card:
//   row 1 — friendly title chip + key identifier (path / command / url) + copy
//   row 2 — status badges (line count, exit code, truncation, diff stats)
//   row 3 — `<details>` collapsible with the bulky output (diff, file body,
//           command output)
//
// Cards never throw on missing fields: if `details`/`text` is unavailable they
// degrade to the minimum readable info (e.g. just the path).

import { memo, useMemo } from 'react';

import { cn } from '@/lib/cn';
import type { ToolUseContent } from '@/features/chat/messages/messages.types';
import {
  extractCommandPreview,
  extractPathPreview,
  extractUrlPreview,
} from '@/features/chat/messages/tool-input-preview';
import { extractEditDiff, type DiffLine } from '@/features/chat/tool-results/extract-edit-diff';
import {
  parseToolResult,
  type ParsedToolResult,
} from '@/features/chat/tool-results/parse-tool-result';
import {
  ToolCardBadge,
  ToolCardCollapsible,
  ToolCardCopyButton,
  ToolCardPath,
  ToolCardPre,
} from '@/features/chat/tool-results/tool-card-primitives';

export type ToolCardLabels = {
  copyPath: string;
  copyCommand: string;
  copied: string;
  viewDiff: string;
  hideDiff: string;
  viewOutput: string;
  hideOutput: string;
  viewContent: string;
  hideContent: string;
  linesBadge: string;
  linesPartial: string;
  diffStats: string;
  sizeBadge: string;
  exitCodeOk: string;
  exitCodeNonZero: string;
  exitCodeUnknown: string;
  timedOut: string;
  truncatedBadge: string;
  noOutput: string;
  rawDetails: string;
};

function interpolate(tmpl: string, values: Record<string, string | number>): string {
  return tmpl.replace(/\{\{(\w+)\}\}/g, (_, k) => {
    const v = values[k];
    return v === undefined || v === null ? '' : String(v);
  });
}

function detailsAsRecord(parsed: ParsedToolResult): Record<string, unknown> {
  return parsed.details ?? {};
}

/* ------------------------------- read_file -------------------------------- */

const READ_LINES_MARKER = /\[(\d+)\/(\d+) lines\]\s*$/;

function extractReadLinesMarker(text: string): { shown: number; total: number } | null {
  const m = text.match(READ_LINES_MARKER);
  if (!m) return null;
  const shown = Number(m[1]);
  const total = Number(m[2]);
  if (!Number.isFinite(shown) || !Number.isFinite(total)) return null;
  return { shown, total };
}

function stripReadLinesMarker(text: string): string {
  return text.replace(READ_LINES_MARKER, '').trimEnd();
}

export const ReadFileCard = memo(function ReadFileCard({
  block,
  labels,
}: {
  block: ToolUseContent;
  labels: ToolCardLabels;
}) {
  const path = extractPathPreview(block.input);
  const parsed = useMemo(() => parseToolResult(block.result), [block.result]);
  const bodyAll = parsed.text;
  const marker = useMemo(() => extractReadLinesMarker(bodyAll), [bodyAll]);
  const body = useMemo(() => stripReadLinesMarker(bodyAll), [bodyAll]);
  const totalLineCount = useMemo(() => {
    if (marker) return marker.total;
    if (!body) return 0;
    return body.split('\n').length;
  }, [body, marker]);
  const previewLineLimit = 12;
  const previewText = useMemo(() => {
    if (!body) return '';
    const lines = body.split('\n');
    if (lines.length <= previewLineLimit) return body;
    return `${lines.slice(0, previewLineLimit).join('\n')}\n…`;
  }, [body]);

  return (
    <div className="content-block-action-scope space-y-1.5">
      <div className="flex min-w-0 flex-wrap items-baseline gap-x-2 gap-y-1">
        {path ? <ToolCardPath title={path}>{path}</ToolCardPath> : null}
        {totalLineCount > 0 ? (
          <ToolCardBadge>
            {marker && marker.shown < marker.total
              ? interpolate(labels.linesPartial, { shown: marker.shown, total: marker.total })
              : interpolate(labels.linesBadge, { count: totalLineCount })}
          </ToolCardBadge>
        ) : null}
        {path ? (
          <ToolCardCopyButton text={path} label={labels.copyPath} copiedLabel={labels.copied} />
        ) : null}
      </div>
      {body ? (
        <ToolCardCollapsible summary={labels.viewContent}>
          <ToolCardPre>{previewText}</ToolCardPre>
        </ToolCardCollapsible>
      ) : null}
    </div>
  );
});

/* ------------------------------ apply_patch ------------------------------- */

function DiffBody({ lines }: { lines: DiffLine[] }) {
  return (
    <pre className="max-h-80 w-full min-w-0 max-w-full overflow-auto rounded-md bg-surface-hover/60 p-2 font-mono text-xs leading-snug text-fg-muted dark:bg-surface-hover/35">
      {lines.map((l, i) => (
        <div
          key={i}
          className={cn(
            'whitespace-pre-wrap break-words [overflow-wrap:anywhere]',
            l.kind === 'add' && 'bg-emerald-500/15 text-emerald-700 dark:text-emerald-300',
            l.kind === 'del' && 'bg-danger-soft text-danger',
            l.kind === 'hunk' && 'text-fg-subtle',
            l.kind === 'meta' && 'text-fg-disabled',
          )}
        >
          {l.text || ' '}
        </div>
      ))}
    </pre>
  );
}

type ChangeSummaryItem = {
  path: string;
  kind?: string;
  added?: number;
  removed?: number;
};

function extractChangeItems(details: Record<string, unknown>): ChangeSummaryItem[] {
  if (!Array.isArray(details.changes)) return [];
  const items: ChangeSummaryItem[] = [];
  for (const raw of details.changes) {
    if (!raw || typeof raw !== 'object' || Array.isArray(raw)) continue;
    const rec = raw as Record<string, unknown>;
    const path = typeof rec.path === 'string' ? rec.path.trim() : '';
    if (!path) continue;
    items.push({
      path,
      ...(typeof rec.kind === 'string' ? { kind: rec.kind } : {}),
      ...(typeof rec.added === 'number' && Number.isFinite(rec.added) ? { added: rec.added } : {}),
      ...(typeof rec.removed === 'number' && Number.isFinite(rec.removed) ? { removed: rec.removed } : {}),
    });
  }
  return items;
}

function changeKindGlyph(kind?: string): { glyph: string; tone: string } {
  switch ((kind ?? '').toLowerCase()) {
    case 'create':
    case 'add':
    case 'added':
      return { glyph: 'A', tone: 'text-emerald-600 dark:text-emerald-400' };
    case 'delete':
    case 'deleted':
      return { glyph: 'D', tone: 'text-red-600 dark:text-red-400' };
    case 'rename':
    case 'renamed':
      return { glyph: 'R', tone: 'text-amber-600 dark:text-amber-400' };
    default:
      return { glyph: 'M', tone: 'text-accent-fg' };
  }
}

export const EditFileCard = memo(function EditFileCard({
  block,
  labels,
}: {
  block: ToolUseContent;
  labels: ToolCardLabels;
}) {
  const inputPath = extractPathPreview(block.input);
  const parsed = useMemo(() => parseToolResult(block.result), [block.result]);
  const details = useMemo(() => detailsAsRecord(parsed), [parsed]);
  const changeItems = useMemo(() => extractChangeItems(details), [details]);
  const diff = useMemo(() => extractEditDiff(parsed), [parsed]);
  const displayPath = inputPath || (
    changeItems.length === 1
      ? changeItems[0].path
      : changeItems.length > 1
        ? `${changeItems[0].path} (+${changeItems.length - 1})`
        : ''
  );

  return (
    <div className="content-block-action-scope space-y-1.5">
      <div className="flex min-w-0 flex-wrap items-baseline gap-x-2 gap-y-1">
        {displayPath ? <ToolCardPath title={displayPath}>{displayPath}</ToolCardPath> : null}
        {diff ? (
          <ToolCardBadge tone="accent">
            {interpolate(labels.diffStats, { added: diff.added, removed: diff.removed })}
          </ToolCardBadge>
        ) : null}
        {displayPath ? (
          <ToolCardCopyButton text={changeItems.length > 1 ? changeItems.map((c) => c.path).join('\n') : displayPath} label={labels.copyPath} copiedLabel={labels.copied} />
        ) : null}
      </div>
      {changeItems.length > 1 ? (
        <div className="space-y-0.5 rounded-md border border-edge-subtle/70 bg-surface-hover/35 px-2 py-1.5 text-xs">
          {changeItems.slice(0, 8).map((item) => {
            const { glyph, tone } = changeKindGlyph(item.kind);
            return (
              <div key={item.path} className="flex min-w-0 items-center gap-2 font-mono">
                <span className={cn('w-3 shrink-0 text-center text-[10px] font-semibold', tone)}>{glyph}</span>
                <span className="min-w-0 flex-1 truncate text-fg-muted" title={item.path}>{item.path}</span>
                {item.added || item.removed ? (
                  <span className="shrink-0 text-[11px] tabular-nums">
                    {item.added ? <span className="text-emerald-600 dark:text-emerald-400">+{item.added}</span> : null}
                    {item.added && item.removed ? ' ' : null}
                    {item.removed ? <span className="text-red-600 dark:text-red-400">-{item.removed}</span> : null}
                  </span>
                ) : null}
              </div>
            );
          })}
          {changeItems.length > 8 ? (
            <div className="pt-0.5 text-[11px] text-fg-subtle">+{changeItems.length - 8} more files</div>
          ) : null}
        </div>
      ) : null}
      {diff ? (
        <ToolCardCollapsible summary={labels.viewDiff} defaultOpen>
          <DiffBody lines={diff.lines} />
        </ToolCardCollapsible>
      ) : parsed.text ? (
        <p className="text-xs text-fg-muted [overflow-wrap:anywhere]">{parsed.text}</p>
      ) : null}
    </div>
  );
});

/* ------------------------------ write_file -------------------------------- */

function formatBytes(n: number): string {
  if (!Number.isFinite(n) || n < 0) return '';
  if (n < 1024) return `${n} B`;
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(1)} KB`;
  return `${(n / (1024 * 1024)).toFixed(1)} MB`;
}

export const WriteFileCard = memo(function WriteFileCard({
  block,
  labels,
}: {
  block: ToolUseContent;
  labels: ToolCardLabels;
}) {
  const path = extractPathPreview(block.input);
  const parsed = useMemo(() => parseToolResult(block.result), [block.result]);
  const details = detailsAsRecord(parsed);
  const sizeBytes = typeof details.size === 'number' ? details.size : null;

  return (
    <div className="content-block-action-scope flex min-w-0 flex-wrap items-baseline gap-x-2 gap-y-1">
      {path ? <ToolCardPath title={path}>{path}</ToolCardPath> : null}
      {sizeBytes != null ? (
        <ToolCardBadge>{interpolate(labels.sizeBadge, { size: formatBytes(sizeBytes) })}</ToolCardBadge>
      ) : null}
      {path ? (
        <ToolCardCopyButton text={path} label={labels.copyPath} copiedLabel={labels.copied} />
      ) : null}
    </div>
  );
});

/* ------------------------------ exec_command ------------------------------ */

const COMMAND_PREVIEW_LINE_LIMIT = 12;

function commandOutputPreview(text: string): { preview: string; truncated: boolean } {
  if (!text) return { preview: '', truncated: false };
  const lines = text.split('\n');
  if (lines.length <= COMMAND_PREVIEW_LINE_LIMIT) return { preview: text, truncated: false };
  return {
    preview: `${lines.slice(0, COMMAND_PREVIEW_LINE_LIMIT).join('\n')}\n…`,
    truncated: true,
  };
}

function formatCommandDuration(durationMs: unknown): string | null {
  if (typeof durationMs !== 'number' || !Number.isFinite(durationMs) || durationMs < 0) return null;
  if (durationMs < 1_000) return `${Math.round(durationMs)}ms`;
  return `${(durationMs / 1_000).toFixed(1)}s`;
}

export const CommandCard = memo(function CommandCard({
  block,
  labels,
}: {
  block: ToolUseContent;
  labels: ToolCardLabels;
}) {
  const parsed = useMemo(() => parseToolResult(block.result), [block.result]);
  const liveDetails = block.details && typeof block.details === 'object' && !Array.isArray(block.details)
    ? (block.details as Record<string, unknown>)
    : null;
  const details = liveDetails ?? detailsAsRecord(parsed);
  const command = (typeof details.command === 'string' && details.command.trim()) || extractCommandPreview(block.input);
  const truncated = Boolean(details.truncated);
  const timedOut = details.timedOut === true;
  const exitCode = typeof details.exitCode === 'number' && Number.isFinite(details.exitCode) ? details.exitCode : null;
  const durationLabel = formatCommandDuration(details.durationMs);
  const output =
    typeof details.aggregatedOutput === 'string' && details.aggregatedOutput.length > 0
      ? details.aggregatedOutput
      : parsed.text;
  const { preview } = useMemo(() => commandOutputPreview(output), [output]);

  return (
    <div className="content-block-action-scope space-y-1.5">
      <div className="flex min-w-0 flex-wrap items-baseline gap-x-2 gap-y-1">
        {command ? (
          <ToolCardPath title={command}>
            <span className="mr-1 text-fg-disabled">$</span>
            {command}
          </ToolCardPath>
        ) : null}
        {timedOut ? (
          <ToolCardBadge tone="negative">{labels.timedOut}</ToolCardBadge>
        ) : exitCode !== null && block.status !== 'running' ? (
          <ToolCardBadge tone={exitCode === 0 ? 'positive' : 'negative'}>
            {exitCode === 0
              ? labels.exitCodeOk
              : interpolate(labels.exitCodeNonZero, { code: exitCode })}
          </ToolCardBadge>
        ) : null}
        {durationLabel && block.status !== 'running' ? (
          <ToolCardBadge>{durationLabel}</ToolCardBadge>
        ) : null}
        {truncated ? <ToolCardBadge>{labels.truncatedBadge}</ToolCardBadge> : null}
        {command ? (
          <ToolCardCopyButton
            text={command}
            label={labels.copyCommand}
            copiedLabel={labels.copied}
          />
        ) : null}
      </div>
      {output ? (
        <ToolCardCollapsible summary={labels.viewOutput}>
          <ToolCardPre>{preview}</ToolCardPre>
        </ToolCardCollapsible>
      ) : block.status !== 'running' ? (
        <p className="text-xs text-fg-disabled">{labels.noOutput}</p>
      ) : null}
    </div>
  );
});

/* -------------------------------- web_fetch ------------------------------- */

export const FetchUrlCard = memo(function FetchUrlCard({
  block,
  labels,
}: {
  block: ToolUseContent;
  labels: ToolCardLabels;
}) {
  const url = extractUrlPreview(block.input);
  const parsed = useMemo(() => parseToolResult(block.result), [block.result]);
  const details = detailsAsRecord(parsed);
  const charCount = typeof details.extractedLength === 'number' ? details.extractedLength : null;
  const preview = useMemo(() => {
    if (!parsed.text) return '';
    const lines = parsed.text.split('\n');
    if (lines.length <= 12) return parsed.text;
    return `${lines.slice(0, 12).join('\n')}\n…`;
  }, [parsed.text]);

  return (
    <div className="space-y-1.5">
      <div className="flex min-w-0 flex-wrap items-baseline gap-x-2 gap-y-1">
        {url ? (
          <a
            href={url}
            target="_blank"
            rel="noopener noreferrer"
            className="inline-flex max-w-full min-w-0 items-center break-words rounded-md bg-surface-hover/60 px-1.5 py-0.5 font-mono text-xs text-accent-fg underline-offset-2 hover:underline [overflow-wrap:anywhere] dark:bg-surface-hover/35"
            title={url}
          >
            {url}
          </a>
        ) : null}
        {charCount != null && charCount > 0 ? (
          <ToolCardBadge>
            {interpolate(labels.linesBadge, { count: charCount })}
          </ToolCardBadge>
        ) : null}
      </div>
      {preview ? (
        <ToolCardCollapsible summary={labels.viewContent}>
          <ToolCardPre>{preview}</ToolCardPre>
        </ToolCardCollapsible>
      ) : null}
    </div>
  );
});
