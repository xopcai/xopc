import fs from 'node:fs/promises';
import path from 'node:path';

import { DREAMING_DIR_RELATIVE } from './constants.js';
import type { DreamingLightConfig } from './config.js';
import {
  bumpEntryPhaseSignal,
  loadDreamingStore,
  saveDreamingStore,
  withDreamingStoreLock,
  type DreamingStoreEntry,
} from './short-term-store.js';
import { buildEntryKey, normalizeMemoryPath } from './utils.js';
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
  dreamingRoot: string;
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
  if (!cfg.enabled) {
    const reason = 'light sweep disabled';
    await writeLastRun(params.dreamingRoot, {
      runId, startedAt, cfg, ok: true, reason, startMs,
      light: { scannedEntries: 0, newSignals: 0, deduped: 0 },
    });
    return { ok: true, reason, scannedEntries: 0, newSignals: 0, deduped: 0 };
  }

  try {
    const result = await withDreamingStoreLock(params.dreamingRoot, async () => {
      const { store } = await loadDreamingStore({ dreamingRoot: params.dreamingRoot });
      const candidates = await scanRecentMemoryLines(params.workspaceDir, cfg.lookbackDays, now);
      let scannedEntries = 0;
      let newSignals = 0;
      let deduped = 0;
      for (const candidate of candidates.slice(0, cfg.limit)) {
        scannedEntries += 1;
        const key = buildEntryKey(candidate);
        const existing = store.entries[key];
        if (existing) {
          if (observedAtOrZero(existing) >= candidate.observedAtMs) {
            deduped += 1;
            continue;
          }
          existing.snippet = candidate.snippet;
          existing.lastObservedAt = candidate.observedAt;
          bumpEntryPhaseSignal(existing, 'sourceCount');
          bumpEntryPhaseSignal(existing, 'lightHits');
          continue;
        }
        const duplicate = Object.values(store.entries).find((entry) =>
          similarity(entry.snippet, candidate.snippet) >= cfg.dedupeSimilarity,
        );
        if (duplicate) {
          if (observedAtOrZero(duplicate) < candidate.observedAtMs) {
            duplicate.lastObservedAt = candidate.observedAt;
            bumpEntryPhaseSignal(duplicate, 'sourceCount');
            bumpEntryPhaseSignal(duplicate, 'lightHits');
          }
          deduped += 1;
          continue;
        }
        store.entries[key] = newLightEntry(candidate);
        newSignals += 1;
      }
      if (scannedEntries > 0) {
        store.updatedAt = startedAt;
        await saveDreamingStore({ dreamingRoot: params.dreamingRoot, store });
      }
      return { scannedEntries, newSignals, deduped };
    });
    await writeLastRun(params.dreamingRoot, {
      runId, startedAt, cfg, ok: true, reason: 'light sweep complete', startMs, light: result,
    });
    return { ok: true, reason: 'light sweep complete', ...result };
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : String(error);
    await writeLastRun(params.dreamingRoot, {
      runId, startedAt, cfg, ok: false, reason: `light error: ${errorMessage}`, startMs,
      light: { scannedEntries: 0, newSignals: 0, deduped: 0 }, errorMessage,
    }).catch(() => undefined);
    return { ok: false, reason: errorMessage, scannedEntries: 0, newSignals: 0, deduped: 0 };
  }
}

type LightCandidate = {
  path: string;
  startLine: number;
  endLine: number;
  snippet: string;
  observedAt: string;
  observedAtMs: number;
};

async function scanRecentMemoryLines(workspaceDir: string, lookbackDays: number, now: Date): Promise<LightCandidate[]> {
  const root = path.join(workspaceDir, 'memory');
  const cutoffMs = now.getTime() - lookbackDays * 24 * 60 * 60 * 1_000;
  const files = await listMarkdownFiles(root);
  const out: LightCandidate[] = [];
  for (const filePath of files) {
    const stat = await fs.stat(filePath).catch(() => null);
    if (!stat || stat.mtimeMs < cutoffMs) continue;
    const content = await fs.readFile(filePath, 'utf-8').catch(() => '');
    const relativePath = normalizeMemoryPath(path.relative(workspaceDir, filePath));
    let inFence = false;
    for (const [index, rawLine] of content.split(/\r?\n/).entries()) {
      if (/^\s*```/.test(rawLine)) {
        inFence = !inFence;
        continue;
      }
      if (inFence) continue;
      const snippet = rawLine.replace(/^\s*[-*]\s+/, '').trim();
      if (snippet.length < 8 || snippet.startsWith('#') || snippet.startsWith('<!--')) continue;
      out.push({
        path: relativePath,
        startLine: index + 1,
        endLine: index + 1,
        snippet: snippet.slice(0, 360),
        observedAt: stat.mtime.toISOString(),
        observedAtMs: stat.mtimeMs,
      });
    }
  }
  return out.sort((left, right) =>
    right.observedAtMs - left.observedAtMs
    || left.path.localeCompare(right.path)
    || left.startLine - right.startLine,
  );
}

async function listMarkdownFiles(root: string): Promise<string[]> {
  const entries = await fs.readdir(root, { withFileTypes: true }).catch(() => []);
  const out: string[] = [];
  for (const entry of entries) {
    const fullPath = path.join(root, entry.name);
    if (entry.isDirectory()) out.push(...await listMarkdownFiles(fullPath));
    else if (entry.isFile() && entry.name.toLowerCase().endsWith('.md')) out.push(fullPath);
  }
  return out;
}

function similarity(left: string, right: string): number {
  const tokens = (value: string) => new Set(value.toLocaleLowerCase().match(/[\p{L}\p{N}]+/gu) ?? []);
  const a = tokens(left);
  const b = tokens(right);
  if (a.size === 0 || b.size === 0) return 0;
  let intersection = 0;
  for (const token of a) if (b.has(token)) intersection += 1;
  return intersection / (a.size + b.size - intersection);
}

function observedAtOrZero(entry: DreamingStoreEntry): number {
  const parsed = entry.lastObservedAt ? Date.parse(entry.lastObservedAt) : 0;
  return Number.isFinite(parsed) ? parsed : 0;
}

function newLightEntry(candidate: LightCandidate): DreamingStoreEntry {
  const key = buildEntryKey(candidate);
  return {
    key,
    path: candidate.path,
    startLine: candidate.startLine,
    endLine: candidate.endLine,
    snippet: candidate.snippet,
    recallCount: 0,
    sourceCount: 1,
    groundedCount: 0,
    lightHits: 1,
    remHits: 0,
    phaseHitCount: 2,
    totalSignalCount: 2,
    totalScore: 0,
    maxScore: 0,
    queryHashes: [],
    recallDays: [],
    firstRecalledAt: candidate.observedAt,
    lastRecalledAt: candidate.observedAt,
    lastObservedAt: candidate.observedAt,
  };
}

// ── Last-run writer ────────────────────────────────────────────────────

async function writeLastRun(
  dreamingRoot: string,
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

  const lastRunPath = path.join(dreamingRoot, DREAMING_DIR_RELATIVE, 'last-run-light.json');
  await fs.mkdir(path.dirname(lastRunPath), { recursive: true });
  const tmp = `${lastRunPath}.${process.pid}.${Date.now()}.tmp`;
  await fs.writeFile(tmp, `${JSON.stringify(lastRun, null, 2)}\n`, 'utf-8');
  await fs.rename(tmp, lastRunPath);
}
