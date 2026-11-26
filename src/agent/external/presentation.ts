import { isAbsolute, relative, sep } from 'node:path';

import type { TurnOutcome } from '@xopcai/gateway-contract';

type TurnChangeSet = NonNullable<TurnOutcome['changeSet']>;
type TurnEvidence = TurnOutcome['evidence'][number];

import type { TurnPlanStep, TurnPlanStatus } from '../tools/update-plan-tool.js';
import type { ExternalRuntimeToolResult } from './types.js';

export const MAX_EXTERNAL_TOOL_TEXT = 32_000;
const MAX_CHANGE_DIFF_PER_FILE = 4_000;
const MAX_TURN_DIFF_CHARS = 32_000;

export type NormalizedFileChange = {
  path: string;
  kind: 'create' | 'update' | 'delete' | 'rename';
  diff: string;
  added: number;
  removed: number;
};

/**
 * Convert an absolute path inside the workspace into a clean POSIX-style relative path
 * so tool headers, diff cards, and turn summaries stay concise and user-friendly.
 */
export function toWorkspaceRelativePath(rawPath: string, cwd: string): string {
  const trimmed = rawPath.trim();
  if (!trimmed) return '';
  if (!isAbsolute(trimmed)) return trimmed.replace(/^\.\//, '');
  const rel = relative(cwd, trimmed);
  if (rel && !rel.startsWith('..') && !isAbsolute(rel)) {
    return rel.split(sep).join('/');
  }
  return trimmed;
}

/**
 * Strip common non-interactive shell wrappers (`/bin/zsh -lc "..."`, `bash -c '...'`)
 * so command cards show the real command while keeping the raw command available if needed.
 */
export function unwrapShellCommand(rawCommand: string): { displayCommand: string; rawCommand?: string } {
  const trimmed = rawCommand.trim();
  if (!trimmed) return { displayCommand: '' };
  const match = trimmed.match(
    /^(?:\/(?:usr\/)?(?:local\/)?bin\/)?(?:zsh|bash|sh|fish)\s+(?:-[a-zA-Z]*c[a-zA-Z]*)\s+([\s\S]+)$/,
  );
  if (!match) return { displayCommand: trimmed };
  let inner = match[1].trim();
  if (
    (inner.startsWith('"') && inner.endsWith('"') && inner.length >= 2)
    || (inner.startsWith("'") && inner.endsWith("'") && inner.length >= 2)
  ) {
    inner = inner.slice(1, -1);
  }
  inner = inner.replace(/\\"/g, '"').trim();
  if (!inner || inner === trimmed) return { displayCommand: trimmed };
  return { displayCommand: inner, rawCommand: trimmed };
}

export function normalizeChangeKind(raw: string | undefined): NormalizedFileChange['kind'] {
  const lower = (raw ?? '').trim().toLowerCase();
  if (lower === 'add' || lower === 'create' || lower === 'created' || lower === 'new') return 'create';
  if (lower === 'delete' || lower === 'deleted' || lower === 'remove' || lower === 'removed') return 'delete';
  if (lower === 'rename' || lower === 'renamed' || lower === 'move' || lower === 'moved') return 'rename';
  return 'update';
}

export function countDiffLines(diff: string): { added: number; removed: number } {
  if (!diff) return { added: 0, removed: 0 };
  let added = 0;
  let removed = 0;
  for (const line of diff.split('\n')) {
    if (line.startsWith('+') && !line.startsWith('+++')) added += 1;
    else if (line.startsWith('-') && !line.startsWith('---')) removed += 1;
  }
  return { added, removed };
}

export function summarizeFileChanges(
  rawChanges: ReadonlyArray<{ path: string; kind?: string; diff?: string }>,
  cwd: string,
): {
  changes: NormalizedFileChange[];
  files: string[];
  primaryPath?: string;
  diff: string;
  added: number;
  removed: number;
} {
  const changes: NormalizedFileChange[] = [];
  const files: string[] = [];
  const seen = new Set<string>();
  let totalAdded = 0;
  let totalRemoved = 0;

  for (const entry of rawChanges.slice(0, 100)) {
    const path = toWorkspaceRelativePath(entry.path, cwd);
    if (!path) continue;
    const diff = (entry.diff ?? '').slice(0, MAX_CHANGE_DIFF_PER_FILE);
    const { added, removed } = countDiffLines(diff);
    totalAdded += added;
    totalRemoved += removed;
    changes.push({
      path,
      kind: normalizeChangeKind(entry.kind),
      diff,
      added,
      removed,
    });
    if (!seen.has(path)) {
      seen.add(path);
      files.push(path);
    }
  }

  const diff = changes.map((c) => c.diff).filter(Boolean).join('\n').slice(0, MAX_EXTERNAL_TOOL_TEXT);
  const primaryPath = files.length === 1
    ? files[0]
    : files.length > 1
      ? `${files[0]} (+${files.length - 1})`
      : undefined;

  return { changes, files, primaryPath, diff, added: totalAdded, removed: totalRemoved };
}

export function buildNormalizedApplyPatchResult(input: {
  id: string;
  isError: boolean;
  cwd: string;
  rawChanges: ReadonlyArray<{ path: string; kind?: string; diff?: string }>;
  fallbackOutput?: string;
}): ExternalRuntimeToolResult {
  const summary = summarizeFileChanges(input.rawChanges, input.cwd);
  return {
    id: input.id,
    isError: input.isError,
    content: summary.files.length > 0
      ? [{ type: 'text', text: summary.files.join('\n') }]
      : input.fallbackOutput
        ? [{ type: 'text', text: input.fallbackOutput.slice(0, MAX_EXTERNAL_TOOL_TEXT) }]
        : [],
    details: {
      files: summary.files,
      changes: summary.changes.map(({ path, kind, added, removed }) => ({ path, kind, added, removed })),
      diff: summary.diff,
      added: summary.added,
      removed: summary.removed,
    },
  };
}

export function buildNormalizedExecCommandResult(input: {
  id: string;
  isError: boolean;
  cwd: string;
  command: string;
  rawCommand?: string;
  execCwd?: string;
  exitCode: number | null;
  durationMs?: number;
  output: string;
}): ExternalRuntimeToolResult {
  const { displayCommand, rawCommand } = unwrapShellCommand(input.command);
  const effectiveRaw = input.rawCommand ?? rawCommand;
  const relCwd = input.execCwd ? toWorkspaceRelativePath(input.execCwd, input.cwd) : '';
  return {
    id: input.id,
    isError: input.isError,
    content: input.output ? [{ type: 'text', text: input.output.slice(0, MAX_EXTERNAL_TOOL_TEXT) }] : [],
    details: {
      command: displayCommand || input.command,
      ...(effectiveRaw && effectiveRaw !== displayCommand ? { rawCommand: effectiveRaw } : {}),
      ...(relCwd ? { cwd: relCwd } : {}),
      exitCode: input.exitCode,
      ...(typeof input.durationMs === 'number' && Number.isFinite(input.durationMs) ? { durationMs: input.durationMs } : {}),
      truncated: input.output.length > MAX_EXTERNAL_TOOL_TEXT,
    },
  };
}

export function normalizePlanStatus(raw: unknown): TurnPlanStatus {
  const value = String(raw ?? '').trim().toLowerCase().replace(/-/g, '_');
  if (value === 'completed' || value === 'done' || value === 'finished') return 'completed';
  if (value === 'in_progress' || value === 'inprogress' || value === 'running' || value === 'active') return 'in_progress';
  return 'pending';
}

export function normalizeExternalPlanSteps(rawSteps: ReadonlyArray<{ id?: string; step: string; status: unknown }>): TurnPlanStep[] {
  let sawInProgress = false;
  const out: TurnPlanStep[] = [];
  for (const item of rawSteps.slice(0, 12)) {
    const step = item.step.trim();
    if (!step) continue;
    let status = normalizePlanStatus(item.status);
    if (status === 'in_progress') {
      if (sawInProgress) status = 'pending';
      else sawInProgress = true;
    }
    out.push({ ...(item.id?.trim() ? { id: item.id.trim() } : {}), step, status });
  }
  return out;
}

const VERIFICATION_COMMAND_RE =
  /\b(?:vitest|jest|pytest|mocha|ava|cargo\s+test|go\s+test|tsc|typecheck|type-check|eslint|lint|build|npm\s+test|pnpm\s+(?:run\s+)?(?:test|lint|build|typecheck)|yarn\s+(?:test|lint|build))\b/i;

export class ExternalTurnOutcomeAggregator {
  private readonly filesByPath = new Map<string, 'added' | 'modified' | 'deleted' | 'renamed'>();
  private readonly diffs: string[] = [];
  private totalAdded = 0;
  private totalRemoved = 0;
  private readonly evidence: TurnEvidence[] = [];

  recordToolResult(toolName: string, result: ExternalRuntimeToolResult): void {
    const details = result.details;
    if (toolName === 'apply_patch' && !result.isError) {
      const changes = Array.isArray(details.changes) ? details.changes : [];
      for (const raw of changes) {
        if (!raw || typeof raw !== 'object') continue;
        const rec = raw as Record<string, unknown>;
        const path = typeof rec.path === 'string' ? rec.path.trim() : '';
        if (!path) continue;
        const kind = normalizeChangeKind(typeof rec.kind === 'string' ? rec.kind : undefined);
        const mapped = kind === 'create' ? 'added' : kind === 'delete' ? 'deleted' : kind === 'rename' ? 'renamed' : 'modified';
        this.filesByPath.set(path, mapped);
      }
      if (typeof details.added === 'number' && Number.isFinite(details.added)) this.totalAdded += details.added;
      if (typeof details.removed === 'number' && Number.isFinite(details.removed)) this.totalRemoved += details.removed;
      if (typeof details.diff === 'string' && details.diff.trim()) this.diffs.push(details.diff);
      return;
    }

    if (toolName === 'exec_command') {
      const command = typeof details.command === 'string' ? details.command.trim() : '';
      if (!command || !VERIFICATION_COMMAND_RE.test(command)) return;
      const exitCode = typeof details.exitCode === 'number' ? details.exitCode : null;
      const status: TurnEvidence['status'] = result.isError || (exitCode !== null && exitCode !== 0)
        ? 'failed'
        : 'passed';
      const durationMs = typeof details.durationMs === 'number' && Number.isFinite(details.durationMs)
        ? details.durationMs
        : undefined;
      this.evidence.push({
        evidenceId: `cmd:${result.id}`,
        kind: 'check',
        label: command.length > 96 ? `${command.slice(0, 95)}…` : command,
        status,
        command,
        ...(durationMs !== undefined ? { durationMs } : {}),
      });
    }
  }

  buildOutcome(input: {
    outcomeId: string;
    runId: string;
    status: TurnOutcome['status'];
    summary?: string;
  }): TurnOutcome {
    const files = [...this.filesByPath.entries()].map(([path, status]) => ({ path, status }));
    const joinedDiff = this.diffs.join('\n');
    const diffTruncated = joinedDiff.length > MAX_TURN_DIFF_CHARS;
    const changeSet: TurnChangeSet | undefined = files.length > 0
      ? {
          changeSetId: `${input.outcomeId}:changes`,
          environment: 'workspace',
          files,
          added: this.totalAdded,
          removed: this.totalRemoved,
          diff: joinedDiff.slice(0, MAX_TURN_DIFF_CHARS),
          ...(diffTruncated ? { diffTruncated: true } : {}),
        }
      : undefined;

    return {
      version: 1,
      outcomeId: input.outcomeId,
      runId: input.runId,
      turnId: input.runId,
      status: input.status,
      ...(input.summary ? { summary: input.summary } : {}),
      deliverables: [],
      evidence: this.evidence.slice(0, 20),
      ...(changeSet ? { changeSet } : {}),
      createdAt: new Date().toISOString(),
    };
  }
}
