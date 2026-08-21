import { basename, dirname } from 'node:path';

import { Text } from '@earendil-works/pi-tui';

import type { TuiToolContentBlock } from './tui-tool-result.js';

const MAX_ARG_VALUE_LENGTH = 120;
const MAX_PATH_LABEL_LENGTH = 72;

export type ToolSummaryKind = 'read' | 'search' | 'exec' | 'generic';

export interface ToolSummaryContext {
  toolName: string;
  args: unknown;
  output: string;
  content?: TuiToolContentBlock[];
  details: unknown;
  isError: boolean;
  expandKey: string;
}

export function formatArgsSummary(args: unknown, toolName: string): string {
  if (!args || typeof args !== 'object') return '';
  const compactRead = isReadStyleTool(toolName) ? formatCompactReadArgs(args) : null;
  if (compactRead) return compactRead;
  const command = isExecStyleTool(toolName) ? commandFromArgs(args) : null;
  if (command) return command;
  const entries = Object.entries(args as Record<string, unknown>);
  if (entries.length === 0) return '';
  return entries
    .map(([key, value]) => {
      const stringValue = formatArgValue(value);
      const truncated =
        stringValue.length > MAX_ARG_VALUE_LENGTH
          ? `${stringValue.slice(0, MAX_ARG_VALUE_LENGTH - 3)}...`
          : stringValue;
      return `${key}=${truncated}`;
    })
    .join(', ');
}

export function getToolSummaryKind(toolName: string): ToolSummaryKind {
  if (isReadStyleTool(toolName)) return 'read';
  if (isSearchStyleTool(toolName)) return 'search';
  if (isExecStyleTool(toolName)) return 'exec';
  return 'generic';
}

export function isReadStyleTool(toolName: string): boolean {
  const base = baseToolName(toolName);
  return ['read', 'read_file', 'memory_get', 'prepare_diff'].includes(base);
}

export function isSearchStyleTool(toolName: string): boolean {
  const base = baseToolName(toolName);
  return [
    'search',
    'grep',
    'rg',
    'ripgrep',
    'file_search',
    'list_files',
  ].includes(base);
}

export function isExecStyleTool(toolName: string): boolean {
  const base = baseToolName(toolName);
  return [
    'bash',
    'shell',
    'exec',
    'run_command',
    'exec_command',
    'terminal',
  ].includes(base);
}

export function displayToolName(toolName: string): string {
  return toolName;
}

export function compactPath(path: string, maxLength = MAX_PATH_LABEL_LENGTH): string {
  const normalized = path.replace(/\\/g, '/');
  if (normalized.length <= maxLength) return normalized;
  const base = basename(normalized);
  const parent = basename(dirname(normalized));
  const suffix = parent ? `${parent}/${base}` : base;
  if (suffix.length + 2 <= maxLength) return `.../${suffix}`;
  return `.../${base.slice(Math.max(0, base.length - maxLength + 3))}`;
}

export function formatCollapsedToolSummary(ctx: ToolSummaryContext): string {
  if (ctx.isError) {
    const rows = nonBlankLines(ctx.output).length;
    const rowLabel = rows === 1 ? '1 error line' : `${rows} error lines`;
    return `error; ${rowLabel}; ${ctx.expandKey} to expand`;
  }

  switch (getToolSummaryKind(ctx.toolName)) {
    case 'read': {
      const rows = new Text(ctx.output, 1, 0).render(80).length;
      const plural = rows === 1 ? 'row' : 'rows';
      return `  ${rows} ${plural}; ${ctx.expandKey} to expand`;
    }
    case 'search':
      return formatSearchSummary(ctx.output, ctx.expandKey);
    case 'exec':
      return formatExecSummary(ctx.output, ctx.details, ctx.isError, ctx.expandKey);
    case 'generic':
      return '';
  }
}

export function formatExecExpandedOutput(output: string, details: unknown): string {
  const parsed = parseExecDetails(details);
  const sections: string[] = [];
  const stdout = parsed.stdout ?? output;
  if (stdout.trim()) {
    sections.push(`stdout\n${stdout}`);
  }
  if (parsed.stderr?.trim()) {
    sections.push(`stderr\n${parsed.stderr}`);
  }
  if (parsed.exitCode !== undefined) {
    sections.push(`exit ${parsed.exitCode}`);
  }
  return sections.join('\n');
}

export function extractExitCode(details: unknown): number | undefined {
  return parseExecDetails(details).exitCode;
}

function formatCompactReadArgs(args: unknown): string | null {
  if (!args || typeof args !== 'object') return null;
  const record = args as Record<string, unknown>;
  const rawPath = typeof record.path === 'string'
    ? record.path
    : typeof record.file_path === 'string'
      ? record.file_path
      : undefined;
  if (!rawPath) return null;

  const normalized = rawPath.replace(/\\/g, '/');
  const base = basename(normalized);
  let label: string;
  if (base === 'SKILL.md') {
    const parent = basename(dirname(normalized));
    label = parent ? `[skill] ${parent}` : '[skill]';
  } else if (base === 'AGENTS.md') {
    label = `read resource ${compactPath(normalized)}`;
  } else {
    label = compactPath(normalized);
  }

  const start = firstFiniteNumber(record.offset, record.from, record.start, record.line);
  const count = firstFiniteNumber(record.limit, record.lines, record.count);
  if (start != null && count != null && count > 0) {
    label += `:${start}-${start + count - 1}`;
  }
  return label;
}

function commandFromArgs(args: unknown): string | null {
  if (!args || typeof args !== 'object') return null;
  const record = args as Record<string, unknown>;
  const raw = record.command ?? record.cmd ?? record.script;
  if (Array.isArray(raw)) return raw.map(String).join(' ');
  if (typeof raw === 'string' && raw.trim()) return raw.trim();
  return null;
}

function baseToolName(toolName: string): string {
  return toolName.split('.').pop()?.toLowerCase() ?? toolName.toLowerCase();
}

function firstFiniteNumber(...values: unknown[]): number | null {
  for (const value of values) {
    if (typeof value === 'number' && Number.isFinite(value)) return Math.floor(value);
    if (typeof value === 'string' && value.trim()) {
      const parsed = Number(value);
      if (Number.isFinite(parsed)) return Math.floor(parsed);
    }
  }
  return null;
}

function formatArgValue(value: unknown): string {
  if (typeof value === 'string') return value;
  if (typeof value === 'bigint') return `${value.toString()}n`;
  if (typeof value === 'function') return '[function]';
  if (typeof value === 'symbol') return String(value);
  if (value instanceof Error) return value.message || value.name;
  try {
    const json = JSON.stringify(value);
    return json === undefined ? String(value) : json;
  } catch {
    return String(value);
  }
}

function formatSearchSummary(output: string, expandKey: string): string {
  const lines = nonBlankLines(output);
  const paths = new Set<string>();
  let matchCount = 0;
  for (const line of lines) {
    const path = extractResultPath(line);
    if (path) paths.add(compactPath(path, 48));
    if (line.trim()) matchCount += 1;
  }

  const matchLabel = matchCount === 1 ? '1 result' : `${matchCount} results`;
  const fileLabel = paths.size === 0
    ? ''
    : paths.size === 1
      ? ` in ${[...paths][0]}`
      : ` in ${paths.size} files`;
  const samples = [...paths].slice(0, 3).join(', ');
  const sampleSuffix = samples && paths.size > 1 ? `: ${samples}` : '';
  return `${matchLabel}${fileLabel}${sampleSuffix}; ${expandKey} to expand`;
}

function formatExecSummary(
  output: string,
  details: unknown,
  isError: boolean,
  expandKey: string,
): string {
  const parsed = parseExecDetails(details);
  const outputText = [parsed.stdout, parsed.stderr].filter(Boolean).join('\n') || output;
  const rows = nonBlankLines(outputText).length;
  const exit = parsed.exitCode === undefined
    ? isError ? 'failed' : 'completed'
    : `exit ${parsed.exitCode}`;
  const rowLabel = rows === 1 ? '1 output line' : `${rows} output lines`;
  return `${exit}; ${rowLabel}; ${expandKey} to expand`;
}

function parseExecDetails(details: unknown): {
  exitCode?: number;
  stdout?: string;
  stderr?: string;
} {
  if (!details || typeof details !== 'object') return {};
  const record = details as Record<string, unknown>;
  return {
    exitCode: numberValue(record.exitCode ?? record.exit_code ?? record.code ?? record.status),
    stdout: stringValue(record.stdout ?? record.output),
    stderr: stringValue(record.stderr ?? record.errorOutput ?? record.error_output),
  };
}

function numberValue(value: unknown): number | undefined {
  if (typeof value === 'number' && Number.isFinite(value)) return Math.trunc(value);
  if (typeof value === 'string' && /^-?\d+$/.test(value)) return Number(value);
  return undefined;
}

function stringValue(value: unknown): string | undefined {
  return typeof value === 'string' ? value : undefined;
}

function nonBlankLines(text: string): string[] {
  return text.split('\n').filter((line) => line.trim().length > 0);
}

function extractResultPath(line: string): string | null {
  const trimmed = line.trim();
  const colonPath = trimmed.match(/^(.+?):\d+(?::\d+)?:/);
  if (colonPath?.[1]) return colonPath[1];
  const jsonPath = trimmed.match(/"?(?:path|file|file_path)"?\s*[:=]\s*"([^"]+)"/i);
  if (jsonPath?.[1]) return jsonPath[1];
  return null;
}
