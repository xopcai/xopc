import fs from 'node:fs/promises';
import path from 'node:path';

import { DREAMING_DIR_RELATIVE } from './constants.js';
import type { DreamingLightConfig } from './config.js';
import {
  DREAMING_LAST_RUN_FORMAT_VERSION,
  type DreamingLightLastRun,
} from './last-run.js';

function resolveConfig(overrides?: Partial<DreamingLightConfig>): DreamingLightConfig {
  return {
    enabled: overrides?.enabled === true,
    cron: typeof overrides?.cron === 'string' ? overrides.cron : '0 */6 * * *',
    lookbackDays: Math.max(1, Math.floor(Number(overrides?.lookbackDays) || 2)),
    limit: Math.max(0, Math.floor(Number(overrides?.limit) || 100)),
    dedupeSimilarity: Math.max(0, Math.min(1, Number(overrides?.dedupeSimilarity) || 0.9)),
  };
}

export async function runLightSweep(params: {
  workspaceDir: string;
  config?: Partial<DreamingLightConfig>;
  now?: Date;
}): Promise<{
  ok: boolean;
  reason: string;
  scannedEntries: number;
  newSignals: number;
  deduped: number;
}> {
  const cfg = resolveConfig(params.config);
  const now = params.now ?? new Date();
  const startedAt = now.toISOString();
  const runId = `light:${startedAt}:${process.pid}`;
  const startMs = Date.now();
  const reason = cfg.enabled
    ? 'light sweep disabled: no implicit file source'
    : 'light sweep disabled';

  await writeLastRun(params.workspaceDir, {
    runId, startedAt, cfg, ok: true, reason, startMs,
    light: { scannedEntries: 0, newSignals: 0, deduped: 0 },
  });
  return { ok: true, reason, scannedEntries: 0, newSignals: 0, deduped: 0 };
}

// ── Last-run writer ────────────────────────────────────────────────────

async function writeLastRun(
  workspaceDir: string,
  params: {
    runId: string;
    startedAt: string;
    cfg: DreamingLightConfig;
    ok: boolean;
    reason: string;
    startMs: number;
    light: DreamingLightLastRun['light'];
    errorMessage?: string;
  },
): Promise<void> {
  const finishedAt = new Date().toISOString();
  const durationMs = Math.max(0, Date.now() - params.startMs);

  const lastRun: DreamingLightLastRun = {
    version: DREAMING_LAST_RUN_FORMAT_VERSION,
    phase: 'light',
    runId: params.runId,
    startedAt: params.startedAt,
    finishedAt,
    durationMs,
    ok: params.ok,
    reason: params.reason,
    config: params.cfg,
    light: params.light,
    ...(params.errorMessage ? { errorMessage: params.errorMessage } : {}),
  };

  const lastRunPath = path.join(workspaceDir, DREAMING_DIR_RELATIVE, 'last-run-light.json');
  await fs.mkdir(path.dirname(lastRunPath), { recursive: true });
  const tmp = `${lastRunPath}.${process.pid}.${Date.now()}.tmp`;
  await fs.writeFile(tmp, `${JSON.stringify(lastRun, null, 2)}\n`, 'utf-8');
  await fs.rename(tmp, lastRunPath);
}
