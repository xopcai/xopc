/**
 * Loop Guard — Detects repetitive tool call patterns within an agent turn
 * and produces context injections for the LLM.
 *
 * Design: pure function that analyzes recent tool call history (already in
 * the transcript) and returns:
 * - A developer-role message to inject into the next LLM request
 * - A set of tool names to temporarily hide from the model
 *
 * This operates at the orchestration layer (before LLM sees tools/messages)
 * rather than the execution layer, so the model naturally stops calling
 * blocked tools without receiving confusing "fake" tool outputs.
 */

import { createLogger } from '../../utils/logger.js';

const log = createLogger('LoopGuard');

export interface RecentToolCall {
  name: string;
  params: unknown;
  /** Optional: tool result text (for same-result detection). */
  resultPreview?: string;
}

export interface LoopGuardConfig {
  /** Consecutive identical calls before injecting a soft warning (default: 2). */
  softThreshold: number;
  /** Consecutive identical calls before hiding the tool (default: 3). */
  hideThreshold: number;
}

export interface LoopGuardResult {
  /** Developer message to inject into LLM context (null = no loop). */
  injection: string | null;
  /** Tool names to remove from the available tools list. */
  hiddenTools: Set<string>;
}

const DEFAULT_CONFIG: LoopGuardConfig = {
  softThreshold: 2,
  hideThreshold: 3,
};

/**
 * Stable fingerprint for tool call comparison.
 * Recursively sorts object keys; truncates long string values.
 */
function fingerprint(toolName: string, params: unknown): string {
  const normalized = JSON.stringify(params, (_key, value) => {
    if (typeof value === 'object' && value !== null && !Array.isArray(value)) {
      return Object.fromEntries(
        Object.entries(value).sort(([a], [b]) => a.localeCompare(b)),
      );
    }
    if (typeof value === 'string' && value.length > 200) {
      return `${value.slice(0, 80)}…[${value.length}]`;
    }
    return value;
  });
  return `${toolName}::${normalized}`;
}

/**
 * Analyze recent tool calls and produce loop guard result.
 *
 * Pure function — no side effects, no shared state.
 */
export function detectToolLoops(
  recentCalls: readonly RecentToolCall[],
  config: Partial<LoopGuardConfig> = {},
): LoopGuardResult {
  const { softThreshold, hideThreshold } = { ...DEFAULT_CONFIG, ...config };

  if (recentCalls.length === 0) {
    return { injection: null, hiddenTools: new Set() };
  }

  // Count consecutive identical calls from the tail
  const consecutiveGroups = findConsecutiveRepeats(recentCalls);
  // Also count total frequency of each fingerprint
  const frequencyMap = countFrequency(recentCalls);

  const warnings: string[] = [];
  const hiddenTools = new Set<string>();

  for (const group of consecutiveGroups) {
    if (group.count >= hideThreshold) {
      hiddenTools.add(group.toolName);
      warnings.push(
        `Tool '${group.toolName}' has been called ${group.count} times consecutively with identical arguments ` +
          `and is now unavailable. Use a completely different approach.`,
      );
      log.warn(
        { tool: group.toolName, consecutiveCount: group.count },
        'Loop guard: hiding tool from LLM',
      );
    } else if (group.count >= softThreshold) {
      warnings.push(
        `You have called '${group.toolName}' ${group.count} times with the same arguments. ` +
          `This is not producing new information. Do NOT call it again with the same arguments — try a different approach.`,
      );
      log.debug(
        { tool: group.toolName, consecutiveCount: group.count },
        'Loop guard: soft warning injected',
      );
    }
  }

  // Also detect high-frequency non-consecutive patterns (A→B→A→B)
  for (const [fp, count] of frequencyMap) {
    const toolName = fp.split('::')[0]!;
    if (count >= hideThreshold + 1 && !hiddenTools.has(toolName)) {
      // Only warn if not already covered by consecutive detection
      const alreadyWarned = consecutiveGroups.some(
        (g) => g.toolName === toolName && g.count >= softThreshold,
      );
      if (!alreadyWarned) {
        warnings.push(
          `Tool '${toolName}' has been called ${count} times this turn with the same arguments (interleaved). ` +
            `Stop repeating this pattern.`,
        );
      }
    }
  }

  const injection =
    warnings.length > 0
      ? `⚠️ LOOP DETECTION:\n${warnings.join('\n')}\n\nYou MUST take a different approach. Do not repeat the same tool calls.`
      : null;

  return { injection, hiddenTools };
}

// ── Helpers ──────────────────────────────────────────────────────────────

interface ConsecutiveGroup {
  toolName: string;
  fingerprint: string;
  count: number;
}

/**
 * Find consecutive runs of identical (tool+params) calls from the end of history.
 * Returns all groups with count >= 2 (most recent first).
 */
function findConsecutiveRepeats(calls: readonly RecentToolCall[]): ConsecutiveGroup[] {
  const groups: ConsecutiveGroup[] = [];
  let index = calls.length - 1;

  while (index >= 0) {
    const current = calls[index]!;
    const fp = fingerprint(current.name, current.params);
    let count = 1;

    // Walk backward counting identical consecutive calls
    while (index - count >= 0) {
      const prev = calls[index - count]!;
      if (fingerprint(prev.name, prev.params) !== fp) break;
      count++;
    }

    if (count >= 2) {
      groups.push({ toolName: current.name, fingerprint: fp, count });
    }

    index -= count;
  }

  return groups;
}

/**
 * Count how many times each (tool+params) fingerprint appears.
 */
function countFrequency(calls: readonly RecentToolCall[]): Map<string, number> {
  const map = new Map<string, number>();
  for (const call of calls) {
    const fp = fingerprint(call.name, call.params);
    map.set(fp, (map.get(fp) ?? 0) + 1);
  }
  return map;
}
