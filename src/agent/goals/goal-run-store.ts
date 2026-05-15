import { createHash, randomUUID } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { join } from 'node:path';

import type { Config } from '../../config/schema.js';
import { extractProfileAgentId } from '../../config/agent-profile.js';
import { resolveAgentHomeDir } from '../agent-scope.js';
import { writeTextAtomic } from '../../infra/write-file-atomic.js';
import { createLogger } from '../../utils/logger.js';

import { checklistCounts } from './checklist-types.js';
import type { GoalPostTurnDecision } from './evaluate-turn.js';
import type { GoalRunFileV1, GoalRunRecord } from './goal-run-types.js';
import { GOAL_RUN_FILE_VERSION } from './goal-run-types.js';

const log = createLogger('GoalRunStore');

const MAX_REASON_CHARS = 4_000;
const MAX_GOAL_CHARS = 4_000;
const MAX_ASSISTANT_PREVIEW_CHARS = 2_000;
const MAX_RUNS_PER_FILE = 400;

function truncate(s: string, max: number): string {
  const t = s.trim();
  if (t.length <= max) return t;
  return `${t.slice(0, max - 1)}…`;
}

export function resolveGoalRunsFilePath(config: Config, sessionKey: string): string {
  const agentId = extractProfileAgentId(sessionKey, config);
  const home = resolveAgentHomeDir(config, agentId);
  const hash = createHash('sha256').update(sessionKey, 'utf8').digest('hex');
  return join(home, 'goal-runs', `${hash}.json`);
}

function isGoalRunFileV1(x: unknown): x is GoalRunFileV1 {
  if (!x || typeof x !== 'object' || Array.isArray(x)) return false;
  const o = x as Record<string, unknown>;
  if (o.version !== GOAL_RUN_FILE_VERSION) return false;
  if (typeof o.sessionKey !== 'string' || !o.sessionKey.trim()) return false;
  if (!Array.isArray(o.runs)) return false;
  return true;
}

function parseGoalRunFile(raw: string): GoalRunFileV1 | null {
  try {
    const parsed = JSON.parse(raw) as unknown;
    if (!isGoalRunFileV1(parsed)) return null;
    return parsed;
  } catch {
    return null;
  }
}

function buildRecordFromDecision(
  sessionKey: string,
  decision: GoalPostTurnDecision,
  assistantPlainText: string,
): GoalRunRecord | null {
  const ns = decision.newState;
  if (!ns) return null;
  const items = ns.checklist ?? [];
  const progress =
    items.length > 0
      ? (() => {
          const c = checklistCounts(items);
          return { done: c.completed + c.impossible, total: c.total };
        })()
      : undefined;

  return {
    id: randomUUID(),
    at: Date.now(),
    goalTitle: truncate(ns.goal, MAX_GOAL_CHARS),
    turnsUsed: ns.turnsUsed,
    maxTurns: ns.maxTurns,
    verdict: decision.verdict,
    statusAfter: ns.status,
    ...(decision.reason.trim() ? { reason: truncate(decision.reason, MAX_REASON_CHARS) } : {}),
    willContinue: decision.shouldContinue,
    ...(progress ? { checklistProgress: progress } : {}),
    ...(assistantPlainText.trim()
      ? { assistantPreview: truncate(assistantPlainText, MAX_ASSISTANT_PREVIEW_CHARS) }
      : {}),
  };
}

/**
 * Append one run after persistent-goal post-turn evaluation (best-effort; logs on failure).
 */
export async function appendGoalRun(opts: {
  config: Config;
  sessionKey: string;
  decision: GoalPostTurnDecision;
  assistantPlainText: string;
}): Promise<void> {
  const { config, sessionKey, decision, assistantPlainText } = opts;
  const record = buildRecordFromDecision(sessionKey, decision, assistantPlainText);
  if (!record) return;

  const filePath = resolveGoalRunsFilePath(config, sessionKey);

  let existing: GoalRunFileV1 = {
    version: GOAL_RUN_FILE_VERSION,
    sessionKey,
    runs: [],
  };

  try {
    const raw = await readFile(filePath, 'utf8');
    const parsed = parseGoalRunFile(raw);
    if (parsed) {
      if (parsed.sessionKey !== sessionKey) {
        log.warn({ sessionKey, filePath }, 'Goal run file sessionKey mismatch; refusing append');
        return;
      }
      existing = parsed;
    }
  } catch (err) {
    const code = err && typeof err === 'object' && 'code' in err ? String((err as NodeJS.ErrnoException).code) : '';
    if (code !== 'ENOENT') {
      log.warn(
        { err, sessionKey, filePath },
        `Goal run read failed: ${err instanceof Error ? err.message : String(err)}`,
      );
      return;
    }
  }

  const nextRuns = [...existing.runs, record];
  const trimmed =
    nextRuns.length > MAX_RUNS_PER_FILE ? nextRuns.slice(nextRuns.length - MAX_RUNS_PER_FILE) : nextRuns;

  const out: GoalRunFileV1 = {
    version: GOAL_RUN_FILE_VERSION,
    sessionKey,
    runs: trimmed,
  };

  await writeTextAtomic(filePath, `${JSON.stringify(out, null, 2)}\n`);
}

/**
 * List runs for a session (newest first). Missing or invalid file yields [].
 */
export async function listGoalRuns(
  config: Config,
  sessionKey: string,
  opts?: { limit?: number },
): Promise<GoalRunRecord[]> {
  const limit = Math.min(500, Math.max(1, Math.floor(opts?.limit ?? 50)));
  const filePath = resolveGoalRunsFilePath(config, sessionKey);
  let raw: string;
  try {
    raw = await readFile(filePath, 'utf8');
  } catch (err) {
    const code = err && typeof err === 'object' && 'code' in err ? String((err as NodeJS.ErrnoException).code) : '';
    if (code === 'ENOENT') return [];
    log.debug(
      { err, sessionKey, filePath },
      `Goal run list read failed: ${err instanceof Error ? err.message : String(err)}`,
    );
    return [];
  }
  const parsed = parseGoalRunFile(raw);
  if (!parsed || parsed.sessionKey !== sessionKey) return [];
  const rev = [...parsed.runs].reverse();
  return rev.slice(0, limit);
}
