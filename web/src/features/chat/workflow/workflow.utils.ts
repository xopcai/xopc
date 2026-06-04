/**
 * Pure helpers for the WorkflowCard. No React, no i18n, no DOM — keeps
 * unit tests trivially fast and lets the card delegate every formatting
 * decision (count phrasing, severity colour) to one place.
 */

import { parseToolResult, type ParsedToolResult } from '@/features/chat/tool-results/parse-tool-result';
import type { ToolUseContent } from '@/features/chat/messages/messages.types';

import type {
  WorkflowAgentSnapshot,
  WorkflowAgentStatus,
  WorkflowCardStatus,
  WorkflowFailureKind,
  WorkflowSnapshot,
} from './workflow.types';

export const WORKFLOW_TOOL_NAME = 'workflow';

/** True when this tool_use block should be rendered with a WorkflowCard. */
export function isWorkflowToolBlock(block: ToolUseContent): boolean {
  return block.name === WORKFLOW_TOOL_NAME;
}

/**
 * Extract a {@link WorkflowSnapshot} from a tool_use block.
 *
 * Lookup order:
 *   1. `block.details` — live SSE `tool_update` payload (P4-A). Available
 *      while the tool is still running, so the card can render the live
 *      progress tree before `tool_end` arrives.
 *   2. `block.result` — final tool_end envelope. Wins after completion
 *      because it carries `result` + final counts the in-flight stream may
 *      not have flushed yet.
 *
 * Returns null when neither shape looks like a snapshot — callers fall back
 * to the generic "running" or "failed" cards.
 */
export function extractSnapshot(block: ToolUseContent): WorkflowSnapshot | null {
  // Final envelope wins once it's there: contains the authoritative duration
  // and `result` even when an earlier streamed `details` snapshot was missing
  // them due to truncation or a dropped final update event.
  if (block.result != null) {
    const parsed: ParsedToolResult = parseToolResult(block.result);
    const fromResult = coerceSnapshot(parsed.details);
    if (fromResult) return fromResult;
  }
  return coerceSnapshot(block.details);
}

function coerceSnapshot(candidate: unknown): WorkflowSnapshot | null {
  if (!candidate || typeof candidate !== 'object') return null;
  const rec = candidate as Record<string, unknown>;
  if (typeof rec.name !== 'string') return null;
  if (!Array.isArray(rec.agents)) return null;
  return candidate as WorkflowSnapshot;
}

/** Resolve the card status from the tool_use block. */
export function resolveCardStatus(block: ToolUseContent): WorkflowCardStatus {
  if (block.status === 'running') return 'running';
  if (block.status === 'error') return 'failed';
  return 'completed';
}

/** Best-effort classification of a failed workflow run from the result text. */
export function classifyFailure(block: ToolUseContent): WorkflowFailureKind {
  const text = readErrorText(block);
  if (!text) return 'runtime_error';
  const lower = text.toLowerCase();
  if (lower.includes('parse error') || lower.includes('snake_case') || lower.includes('first statement'))
    return 'parse_error';
  if (lower.includes('abort')) return 'aborted';
  if (lower.includes('timed out') || lower.includes('timeout')) return 'timeout';
  return 'runtime_error';
}

export function readErrorText(block: ToolUseContent): string {
  if (block.result == null) return '';
  const parsed = parseToolResult(block.result);
  if (parsed.text) return parsed.text;
  if (typeof block.result === 'string') return block.result;
  return '';
}

// ---------------------------------------------------------------------------
// Snapshot derivations
// ---------------------------------------------------------------------------

export interface PhaseRollup {
  title: string;
  agents: WorkflowAgentSnapshot[];
  done: number;
  running: number;
  errored: number;
  skipped: number;
  /** True when every agent in the phase has a terminal status. */
  complete: boolean;
}

/**
 * Group agents under phases in the order phases were declared (or first
 * observed). An "unphased" bucket holds agents whose phase was not declared.
 * Empty phases (declared but never produced an agent and not the current
 * phase) are omitted — matches the TUI rendering and avoids dead rows.
 */
export function rollupPhases(snapshot: WorkflowSnapshot): {
  phases: PhaseRollup[];
  unphased: PhaseRollup | null;
} {
  const observedFromAgents = snapshot.agents
    .map((a) => a.phase)
    .filter((p): p is string => Boolean(p));
  const orderedNames: string[] = [];
  const seen = new Set<string>();
  for (const list of [snapshot.phases, observedFromAgents, snapshot.currentPhase ? [snapshot.currentPhase] : []]) {
    for (const name of list) {
      if (!seen.has(name)) {
        seen.add(name);
        orderedNames.push(name);
      }
    }
  }

  const phases: PhaseRollup[] = [];
  const renderedIds = new Set<number>();
  for (const title of orderedNames) {
    const agents = snapshot.agents.filter((a) => a.phase === title);
    if (agents.length === 0 && snapshot.currentPhase !== title) continue;
    for (const a of agents) renderedIds.add(a.id);
    phases.push(buildRollup(title, agents));
  }

  const leftover = snapshot.agents.filter((a) => !renderedIds.has(a.id));
  const unphased = leftover.length > 0 ? buildRollup('unphased', leftover) : null;

  return { phases, unphased };
}

function buildRollup(title: string, agents: WorkflowAgentSnapshot[]): PhaseRollup {
  let done = 0;
  let running = 0;
  let errored = 0;
  let skipped = 0;
  for (const a of agents) {
    if (a.status === 'done') done++;
    else if (a.status === 'running') running++;
    else if (a.status === 'error') errored++;
    else if (a.status === 'skipped') skipped++;
  }
  const complete = agents.length > 0 && done + errored + skipped === agents.length;
  return { title, agents, done, running, errored, skipped, complete };
}

// ---------------------------------------------------------------------------
// Format helpers
// ---------------------------------------------------------------------------

/** "12s" / "1m 23s" / "1h 5m" — compact, human friendly. */
export function formatDuration(ms: number): string {
  if (!Number.isFinite(ms) || ms < 0) return '';
  const seconds = Math.floor(ms / 1000);
  if (seconds < 60) return `${seconds}s`;
  const minutes = Math.floor(seconds / 60);
  const secRem = seconds % 60;
  if (minutes < 60) return secRem ? `${minutes}m ${secRem}s` : `${minutes}m`;
  const hours = Math.floor(minutes / 60);
  const minRem = minutes % 60;
  return minRem ? `${hours}h ${minRem}m` : `${hours}h`;
}

/** Elapsed time for a live or finished agent row. */
export function agentElapsedMs(agent: WorkflowAgentSnapshot, now = Date.now()): number | null {
  if (agent.durationMs != null && Number.isFinite(agent.durationMs)) return agent.durationMs;
  if (agent.status === 'running' && agent.startedAtMs != null) {
    return Math.max(0, now - agent.startedAtMs);
  }
  return null;
}

export function formatAgentElapsed(agent: WorkflowAgentSnapshot, now = Date.now()): string {
  const ms = agentElapsedMs(agent, now);
  return ms != null ? formatDuration(ms) : '';
}

/**
 * Severity colour swatch used by the result summary. Stays neutral by default
 * (DESIGN.md: "灰色是主角，蓝色是信号") and only reaches for accent / rose
 * when the severity field is explicitly high.
 */
export function severityTone(severity: string | undefined): 'high' | 'med' | 'low' | 'neutral' {
  const v = String(severity ?? '').toLowerCase();
  if (v === 'high' || v === 'critical' || v === 'h') return 'high';
  if (v === 'med' || v === 'medium' || v === 'm') return 'med';
  if (v === 'low' || v === 'l') return 'low';
  return 'neutral';
}

export function statusIconKey(status: WorkflowAgentStatus): 'queued' | 'running' | 'done' | 'error' | 'skipped' {
  return status;
}
