import fs from 'node:fs/promises';
import path from 'node:path';

import { DREAMING_LAST_RUN_RELATIVE } from './constants.js';
import type { DreamingDeepConfig, DreamingLightConfig, DreamingRemConfig } from './config.js';

export const DREAMING_LAST_RUN_FORMAT_VERSION = 2 as const;

export type { DreamingDeepConfig } from './config.js';

export type DreamingDeepPhaseSkipped = {
  alreadyPromotedKey: number;
  rehydrateFailed: number;
  contaminated: number;
  hashDuplicate: number;
};

/**
 * On-disk / API shape for an agent's `memories/.dreams/last-run.json`.
 */
export type DreamingDeepLastRun = {
  version: typeof DREAMING_LAST_RUN_FORMAT_VERSION;
  phase: 'deep';
  runId: string;
  startedAt: string;
  finishedAt: string;
  durationMs: number;
  ok: boolean;
  reason: string;
  config: DreamingDeepConfig;
  memoryPath: string;
  errorMessage?: string;
  deep: {
    candidatesRanked: number;
    applied: number;
    skipped: DreamingDeepPhaseSkipped;
  };
};

/**
 * On-disk shape for light sweep last-run.
 */
export type DreamingLightLastRun = {
  version: typeof DREAMING_LAST_RUN_FORMAT_VERSION;
  phase: 'light';
  runId: string;
  startedAt: string;
  finishedAt: string;
  durationMs: number;
  ok: boolean;
  reason: string;
  config: DreamingLightConfig;
  light: {
    scannedEntries: number;
    newSignals: number;
    deduped: number;
  };
  errorMessage?: string;
};

/**
 * On-disk shape for REM pattern last-run.
 */
export type DreamingRemLastRun = {
  version: typeof DREAMING_LAST_RUN_FORMAT_VERSION;
  phase: 'rem';
  runId: string;
  startedAt: string;
  finishedAt: string;
  durationMs: number;
  ok: boolean;
  reason: string;
  config: DreamingRemConfig;
  rem: {
    patternsDiscovered: number;
    entriesAnalyzed: number;
  };
  errorMessage?: string;
};

/** Union of all phase last-run shapes. */
export type DreamingLastRun = DreamingDeepLastRun | DreamingLightLastRun | DreamingRemLastRun;

function isRecord(v: unknown): v is Record<string, unknown> {
  return v !== null && typeof v === 'object' && !Array.isArray(v);
}

function asNonNegInt(v: unknown): number {
  if (typeof v === 'number' && Number.isFinite(v)) return Math.max(0, Math.floor(v));
  if (typeof v === 'string' && v.trim() && Number.isFinite(Number(v))) {
    return Math.max(0, Math.floor(Number(v)));
  }
  return 0;
}

function asDreamingDeepConfig(v: unknown): DreamingDeepConfig | null {
  if (!isRecord(v)) return null;
  return {
    enabled: v.enabled === true,
    cron: typeof v.cron === 'string' ? v.cron : '0 3 * * *',
    minScore: typeof v.minScore === 'number' && Number.isFinite(v.minScore) ? v.minScore : 0,
    minRecallCount: asNonNegInt(v.minRecallCount) || 1,
    minUniqueQueries: asNonNegInt(v.minUniqueQueries) || 3,
    limit: asNonNegInt(v.limit),
    recencyHalfLifeDays: asNonNegInt(v.recencyHalfLifeDays) || 14,
    maxAgeDays: asNonNegInt(v.maxAgeDays) || 30,
  };
}

const EMPTY_SKIPPED: DreamingDeepPhaseSkipped = {
  alreadyPromotedKey: 0,
  rehydrateFailed: 0,
  contaminated: 0,
  hashDuplicate: 0,
};

function parseSkippedStrict(raw: unknown): DreamingDeepPhaseSkipped | null {
  if (!isRecord(raw)) return null;
  if (
    typeof raw.alreadyPromotedKey !== 'number' ||
    !Number.isFinite(raw.alreadyPromotedKey) ||
    typeof raw.rehydrateFailed !== 'number' ||
    !Number.isFinite(raw.rehydrateFailed) ||
    typeof raw.contaminated !== 'number' ||
    !Number.isFinite(raw.contaminated) ||
    typeof raw.hashDuplicate !== 'number' ||
    !Number.isFinite(raw.hashDuplicate)
  ) {
    return null;
  }
  return {
    alreadyPromotedKey: Math.max(0, Math.floor(raw.alreadyPromotedKey)),
    rehydrateFailed: Math.max(0, Math.floor(raw.rehydrateFailed)),
    contaminated: Math.max(0, Math.floor(raw.contaminated)),
    hashDuplicate: Math.max(0, Math.floor(raw.hashDuplicate)),
  };
}

/**
 * Parse `last-run.json`. Only the current on-disk format (`version: 2`, `phase: 'deep'`) is accepted.
 */
export function parseDreamingLastRunFile(raw: unknown): DreamingDeepLastRun | null {
  if (!isRecord(raw)) return null;
  if (raw.version !== DREAMING_LAST_RUN_FORMAT_VERSION || raw.phase !== 'deep') return null;

  if (typeof raw.runId !== 'string' || !raw.runId.trim()) return null;
  if (typeof raw.startedAt !== 'string' || typeof raw.finishedAt !== 'string') return null;
  if (!raw.startedAt.trim() || !raw.finishedAt.trim()) return null;

  if (typeof raw.durationMs !== 'number' || !Number.isFinite(raw.durationMs) || raw.durationMs < 0) {
    return null;
  }
  if (raw.ok !== true && raw.ok !== false) return null;
  if (typeof raw.reason !== 'string') return null;

  const config = asDreamingDeepConfig(raw.config);
  if (!config) return null;
  if (typeof raw.memoryPath !== 'string' || !raw.memoryPath.trim()) return null;

  const deepRaw = raw.deep;
  if (!isRecord(deepRaw)) return null;
  if (typeof deepRaw.candidatesRanked !== 'number' || !Number.isFinite(deepRaw.candidatesRanked)) {
    return null;
  }
  if (typeof deepRaw.applied !== 'number' || !Number.isFinite(deepRaw.applied)) return null;
  const skipped = parseSkippedStrict(deepRaw.skipped);
  if (!skipped) return null;

  const err = raw.errorMessage;
  const errMsg = typeof err === 'string' && err.trim() ? err.trim() : undefined;

  return {
    version: DREAMING_LAST_RUN_FORMAT_VERSION,
    phase: 'deep',
    runId: raw.runId.trim(),
    startedAt: raw.startedAt,
    finishedAt: raw.finishedAt,
    durationMs: Math.max(0, Math.floor(raw.durationMs)),
    ok: raw.ok === true,
    reason: raw.reason,
    config,
    memoryPath: raw.memoryPath,
    ...(errMsg ? { errorMessage: errMsg } : {}),
    deep: {
      candidatesRanked: Math.max(0, Math.floor(deepRaw.candidatesRanked)),
      applied: Math.max(0, Math.floor(deepRaw.applied)),
      skipped,
    },
  };
}

export function emptyDeepPhaseSkipped(): DreamingDeepPhaseSkipped {
  return { ...EMPTY_SKIPPED };
}

export async function writeDreamingDeepLastRun(params: {
  dreamingRoot: string;
  lastRun: DreamingDeepLastRun;
}): Promise<void> {
  const fullPath = path.join(params.dreamingRoot, DREAMING_LAST_RUN_RELATIVE);
  await fs.mkdir(path.dirname(fullPath), { recursive: true });
  const tmp = `${fullPath}.${process.pid}.${Date.now()}.tmp`;
  await fs.writeFile(tmp, `${JSON.stringify(params.lastRun, null, 2)}\n`, 'utf-8');
  await fs.rename(tmp, fullPath);
}
