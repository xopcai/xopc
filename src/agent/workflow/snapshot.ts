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
  WorkflowMeta,
  WorkflowSnapshot,
} from './types.js';
import { emptySnapshotFor } from './runtime.js';

export function createWorkflowSnapshot(meta: WorkflowMeta): WorkflowSnapshot {
  return emptySnapshotFor(
    meta.name,
    meta.description,
    meta.phases?.map((p) => p.title),
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
