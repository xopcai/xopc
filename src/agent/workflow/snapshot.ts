/**
 * Workflow progress snapshot model + text renderers.
 *
 * The runtime emits per-event callbacks (`onPhase`, `onAgentStart`, `onAgentEnd`,
 * `onLog`). The workflow tool wraps those callbacks to mutate a snapshot and push
 * a text rendering through `onUpdate` — keeping TUI / Gateway / IM consumers in
 * lock-step from a single source of truth.
 */

import type {
  WorkflowAgentSnapshot,
  WorkflowAgentStatus,
  WorkflowSnapshotDefinition,
  WorkflowSnapshot,
} from './types.js';
import { emptySnapshotFor } from './snapshot-empty.js';

export function createWorkflowSnapshot(definition: WorkflowSnapshotDefinition): WorkflowSnapshot {
  return emptySnapshotFor(
    definition.name,
    definition.description,
    definition.phases?.map((phase) => phase.title),
  );
}

export function recomputeCounts(snapshot: WorkflowSnapshot): void {
  let running = 0;
  let done = 0;
  let error = 0;
  let skipped = 0;
  for (const agent of snapshot.agents) {
    switch (agent.status) {
      case 'running':
        running++;
        break;
      case 'done':
        done++;
        break;
      case 'error':
        error++;
        break;
      case 'skipped':
        skipped++;
        break;
    }
  }
  snapshot.agentCount = snapshot.agents.length;
  snapshot.runningCount = running;
  snapshot.doneCount = done;
  snapshot.errorCount = error;
  snapshot.skippedCount = skipped;
}

export interface RenderOptions {
  maxAgentsPerPhase?: number;
  maxLogs?: number;
  showResultPreviews?: boolean;
}

export type WorkflowPanelStatus =
  | 'queued'
  | 'running'
  | 'succeeded'
  | 'failed'
  | 'cancelled'
  | 'timeout'
  | string;

export interface WorkflowPanelOptions {
  status?: WorkflowPanelStatus;
  maxActiveAgents?: number;
  maxRecentAgents?: number;
  maxErrors?: number;
  nowMs?: number;
}

export function renderWorkflowText(
  snapshot: WorkflowSnapshot,
  completed = false,
  options: RenderOptions = {},
): string {
  const maxAgentsPerPhase = options.maxAgentsPerPhase ?? 6;
  const maxLogs = options.maxLogs ?? 2;
  const showPreviews = options.showResultPreviews ?? false;

  const state = stateSuffix(snapshot);
  const header = completed
    ? `◆ workflow ✓ ${snapshot.name} (${snapshot.doneCount}/${snapshot.agentCount} done${state})`
    : `◆ workflow: ${snapshot.name} (${snapshot.doneCount}/${snapshot.agentCount} done${state})`;
  const lines = [header];

  const phaseNames = uniqueOrdered([
    ...snapshot.phases,
    ...(snapshot.currentPhase ? [snapshot.currentPhase] : []),
    ...snapshot.agents.map((a) => a.phase).filter((p): p is string => Boolean(p)),
  ]);
  const rendered = new Set<WorkflowAgentSnapshot>();

  for (const phase of phaseNames) {
    const agents = snapshot.agents.filter((a) => a.phase === phase);
    if (agents.length === 0 && snapshot.currentPhase !== phase) continue;
    for (const a of agents) rendered.add(a);

    const counts = countAgents(agents);
    const completeHere = agents.length > 0 && counts.done + counts.error + counts.skipped === agents.length;
    const marker =
      counts.running > 0 || (!completeHere && snapshot.currentPhase === phase)
        ? '▶'
        : completeHere
          ? '✓'
          : ' ';

    const tail =
      (counts.running ? ` · ${counts.running} running` : '') +
      (counts.error ? ` · ${counts.error} errors` : '') +
      (counts.skipped ? ` · ${counts.skipped} skipped` : '');
    lines.push(`  ${marker} ${phase} ${counts.done}/${agents.length}${tail}`);

    const visible = agents.slice(-maxAgentsPerPhase);
    for (const agent of visible) {
      const previewText = showPreviews && agent.resultPreview ? ` — ${agent.resultPreview}` : '';
      lines.push(
        `    #${agent.id} ${statusIcon(agent.status)} ${shorten(agent.label, 56)}${previewText}`,
      );
    }
    if (agents.length > visible.length) {
      lines.push(`    … ${agents.length - visible.length} earlier agents`);
    }
  }

  const unphased = snapshot.agents.filter((a) => !rendered.has(a));
  if (unphased.length > 0) {
    lines.push('  unphased');
    for (const agent of unphased.slice(-maxAgentsPerPhase)) {
      const previewText = showPreviews && agent.resultPreview ? ` — ${agent.resultPreview}` : '';
      lines.push(
        `    #${agent.id} ${statusIcon(agent.status)} ${shorten(agent.label, 56)}${previewText}`,
      );
    }
  }

  const visibleLogs = snapshot.logs.slice(-maxLogs);
  if (visibleLogs.length > 0) {
    lines.push('');
    for (const log of visibleLogs) {
      lines.push(`  log: ${shorten(log, 80)}`);
    }
  }
  return lines.join('\n');
}

export function previewValue(value: unknown, max = 80): string {
  if (value === null || value === undefined) return '';
  const text = typeof value === 'string' ? value : safeStringify(value);
  if (!text) return '';
  return text.length > max ? `${text.slice(0, max - 1)}…` : text;
}

export function renderWorkflowPanel(
  snapshot: WorkflowSnapshot,
  options: WorkflowPanelOptions = {},
): string {
  const status = options.status ?? inferPanelStatus(snapshot);
  const activeAgents = snapshot.agents.filter((agent) => agent.status === 'running');
  const queuedAgents = snapshot.agents.filter((agent) => agent.status === 'queued');
  const activeLimit = options.maxActiveAgents ?? 4;
  const recentLimit = options.maxRecentAgents ?? 4;
  const durationText = formatDuration(resolveElapsedMs(snapshot, options.nowMs));
  const counts = formatRunCounts(snapshot);

  const lines = [
    `◆ ${snapshot.name} ${statusText(status)} ${counts}${durationText ? ` ${durationText}` : ''}`,
  ];

  const phaseLines = renderPanelPhaseLines(snapshot);
  if (phaseLines.length > 0) {
    lines.push('', 'Phase', ...phaseLines);
  }

  const visibleActive = activeAgents.length > 0 ? activeAgents : queuedAgents;
  if (visibleActive.length > 0) {
    lines.push('', activeAgents.length > 0 ? 'Active' : 'Queued');
    for (const agent of visibleActive.slice(0, activeLimit)) {
      lines.push(...renderActiveAgentLines(agent));
    }
    if (visibleActive.length > activeLimit) {
      lines.push(`  … ${visibleActive.length - activeLimit} more`);
    }
  }

  const recent = recentCompletedAgents(snapshot).slice(0, recentLimit);
  if (recent.length > 0) {
    lines.push('', 'Recent');
    for (const agent of recent) {
      lines.push(renderRecentAgentLine(agent));
    }
  }

  const errors = snapshot.agents.filter((agent) => agent.status === 'error' || agent.error);
  if (errors.length > 0) {
    lines.push('', 'Errors');
    for (const agent of errors.slice(0, options.maxErrors ?? 3)) {
      lines.push(
        `  ✗ #${agent.id} ${shorten(agent.label, 28)}${
          agent.error ? `: ${shorten(agent.error, 96)}` : ''
        }`,
      );
    }
    if (errors.length > (options.maxErrors ?? 3)) {
      lines.push(`  … ${errors.length - (options.maxErrors ?? 3)} more`);
    }
  }

  return lines.join('\n');
}

export function renderWorkflowFinalSummary(
  snapshot: WorkflowSnapshot,
  options: WorkflowPanelOptions = {},
): string {
  const status = options.status ?? inferPanelStatus(snapshot);
  const durationText = formatDuration(resolveElapsedMs(snapshot, options.nowMs));
  const lines = [
    `◆ ${snapshot.name} ${statusText(status)} ${formatRunCounts(snapshot)}${durationText ? ` ${durationText}` : ''}`,
  ];

  const result = previewValue(snapshot.result, 280);
  if (result) {
    lines.push('', 'Result', `  ${result}`);
  } else {
    const fallback = recentCompletedAgents(snapshot)
      .map((agent) => agent.resultPreview)
      .find((value): value is string => Boolean(value));
    if (fallback) {
      lines.push('', 'Result', `  ${shorten(fallback, 280)}`);
    }
  }

  const errors = snapshot.agents.filter((agent) => agent.status === 'error' || agent.error);
  if (errors.length > 0) {
    lines.push('', 'Errors');
    for (const agent of errors.slice(0, options.maxErrors ?? 5)) {
      lines.push(
        `  ✗ #${agent.id} ${shorten(agent.label, 32)}${
          agent.error ? `: ${shorten(agent.error, 120)}` : ''
        }`,
      );
    }
  }

  const recent = recentCompletedAgents(snapshot).slice(0, options.maxRecentAgents ?? 5);
  if (recent.length > 0) {
    lines.push('', 'Completed');
    for (const agent of recent) {
      lines.push(renderRecentAgentLine(agent));
    }
  }

  return lines.join('\n');
}

// ---------------------------------------------------------------------------

function countAgents(agents: WorkflowAgentSnapshot[]) {
  let done = 0;
  let running = 0;
  let error = 0;
  let skipped = 0;
  for (const a of agents) {
    if (a.status === 'done') done++;
    else if (a.status === 'running') running++;
    else if (a.status === 'error') error++;
    else if (a.status === 'skipped') skipped++;
  }
  return { done, running, error, skipped };
}

function statusIcon(status: WorkflowAgentStatus): string {
  switch (status) {
    case 'queued':
      return '○';
    case 'running':
      return '●';
    case 'done':
      return '✓';
    case 'error':
      return '✗';
    case 'skipped':
      return '-';
  }
}

function statusText(status: WorkflowPanelStatus): string {
  switch (status) {
    case 'queued':
      return 'queued';
    case 'running':
      return 'running';
    case 'succeeded':
      return '✓ completed';
    case 'failed':
      return '✗ failed';
    case 'cancelled':
      return 'cancelled';
    case 'timeout':
      return 'timeout';
    default:
      return String(status || 'running');
  }
}

function inferPanelStatus(snapshot: WorkflowSnapshot): WorkflowPanelStatus {
  if (snapshot.errorCount > 0) return 'failed';
  if (snapshot.runningCount > 0) return 'running';
  if (snapshot.doneCount + snapshot.skippedCount >= snapshot.agentCount && snapshot.agentCount > 0) {
    return 'succeeded';
  }
  return 'queued';
}

function formatRunCounts(snapshot: WorkflowSnapshot): string {
  const parts = [`${snapshot.doneCount}/${snapshot.agentCount} done`];
  if (snapshot.runningCount > 0) parts.push(`${snapshot.runningCount} running`);
  if (snapshot.errorCount > 0) parts.push(`${snapshot.errorCount} errors`);
  if (snapshot.skippedCount > 0) parts.push(`${snapshot.skippedCount} skipped`);
  return parts.join(' · ');
}

function resolveElapsedMs(snapshot: WorkflowSnapshot, nowMs = Date.now()): number | undefined {
  if (snapshot.durationMs != null) return snapshot.durationMs;
  const starts = snapshot.agents
    .map((agent) => agent.startedAtMs)
    .filter((value): value is number => typeof value === 'number' && Number.isFinite(value));
  if (starts.length === 0) return undefined;
  return Math.max(0, nowMs - Math.min(...starts));
}

function formatDuration(ms: number | undefined): string {
  if (ms == null || !Number.isFinite(ms)) return '';
  const totalSeconds = Math.max(0, Math.floor(ms / 1000));
  const minutes = Math.floor(totalSeconds / 60);
  const seconds = totalSeconds % 60;
  if (minutes < 60) return `${minutes}:${String(seconds).padStart(2, '0')}`;
  const hours = Math.floor(minutes / 60);
  const restMinutes = minutes % 60;
  return `${hours}:${String(restMinutes).padStart(2, '0')}:${String(seconds).padStart(2, '0')}`;
}

function renderPanelPhaseLines(snapshot: WorkflowSnapshot): string[] {
  const phaseNames = uniqueOrdered([
    ...snapshot.phases,
    ...(snapshot.currentPhase ? [snapshot.currentPhase] : []),
    ...snapshot.agents.map((a) => a.phase).filter((p): p is string => Boolean(p)),
  ]);
  const out: string[] = [];
  for (const phase of phaseNames) {
    const agents = snapshot.agents.filter((agent) => agent.phase === phase);
    const counts = countAgents(agents);
    const complete = agents.length > 0 && counts.done + counts.error + counts.skipped === agents.length;
    const marker =
      counts.running > 0 || (!complete && snapshot.currentPhase === phase)
        ? '▶'
        : complete
          ? '✓'
          : '○';
    const tail = [
      counts.running > 0 ? `${counts.running} running` : '',
      counts.error > 0 ? `${counts.error} errors` : '',
      counts.skipped > 0 ? `${counts.skipped} skipped` : '',
    ].filter(Boolean).join(' · ');
    out.push(`  ${marker} ${phase} ${counts.done}/${agents.length}${tail ? ` · ${tail}` : ''}`);
  }
  return out;
}

function renderActiveAgentLines(agent: WorkflowAgentSnapshot): string[] {
  const step = agent.currentStep || latestStepSummary(agent);
  const iteration =
    agent.iteration != null && agent.maxIterations != null
      ? ` [${agent.iteration}/${agent.maxIterations}]`
      : '';
  const head = `  ${agent.status === 'running' ? '●' : '○'} #${agent.id} ${shorten(agent.label, 32)}${iteration}`;
  return step ? [head, `     ${shorten(step, 96)}`] : [head];
}

function renderRecentAgentLine(agent: WorkflowAgentSnapshot): string {
  const preview = agent.error || agent.resultPreview || latestStepResult(agent);
  return `  ${statusIcon(agent.status)} #${agent.id} ${shorten(agent.label, 32)}${
    preview ? ` — ${shorten(preview, 96)}` : ''
  }`;
}

function recentCompletedAgents(snapshot: WorkflowSnapshot): WorkflowAgentSnapshot[] {
  return [...snapshot.agents]
    .filter((agent) => agent.status === 'done' || agent.status === 'error' || agent.status === 'skipped')
    .reverse();
}

function latestStepSummary(agent: WorkflowAgentSnapshot): string {
  const step =
    [...(agent.steps ?? [])].reverse().find((entry) => entry.status === 'running') ??
    agent.steps?.[agent.steps.length - 1];
  if (!step) return '';
  return step.detail ? `${step.label}: ${step.detail}` : step.label;
}

function latestStepResult(agent: WorkflowAgentSnapshot): string {
  const step = [...(agent.steps ?? [])].reverse().find((entry) => entry.resultPreview || entry.error);
  return step?.error || step?.resultPreview || '';
}

function stateSuffix(snapshot: WorkflowSnapshot): string {
  if (snapshot.errorCount > 0) return `, ${snapshot.errorCount} errors`;
  if (snapshot.skippedCount > 0) return `, ${snapshot.skippedCount} skipped`;
  if (snapshot.runningCount > 0) return `, ${snapshot.runningCount} running`;
  return '';
}

function uniqueOrdered(values: string[]): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const v of values) {
    if (!seen.has(v)) {
      seen.add(v);
      out.push(v);
    }
  }
  return out;
}

function shorten(value: string, max: number): string {
  const text = value.replace(/\s+/g, ' ').trim();
  return text.length > max ? `${text.slice(0, max - 1)}…` : text;
}

function safeStringify(value: unknown): string {
  try {
    return JSON.stringify(value);
  } catch {
    return String(value);
  }
}
