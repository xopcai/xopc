import fs from 'node:fs/promises';
import path from 'node:path';

import { createLogger } from '../../../utils/logger.js';
import { DREAMING_DIR_RELATIVE } from './constants.js';
import type { DreamingLightConfig } from './config.js';
import {
  bumpEntryPhaseSignal,
  loadDreamingStore,
  saveDreamingStore,
} from './short-term-store.js';
import {
  buildEntryKey,
  isoDay,
  normalizeMemoryPath,
  normalizeSnippetForHash,
  snippetHash,
} from './utils.js';
import {
  DREAMING_LAST_RUN_FORMAT_VERSION,
  type DreamingLightLastRun,
} from './last-run.js';

const log = createLogger('Dreaming:Light');

// ── Helpers ────────────────────────────────────────────────────────────

function isDailyMemoryFile(filename: string): boolean {
  return /^\d{4}-\d{2}-\d{2}\.md$/i.test(filename);
}

/**
 * Cosine-ish similarity via character n-gram overlap.
 * Fast and deterministic — no embeddings required.
 */
function trigramSimilarity(textA: string, textB: string): number {
  const normalizedA = normalizeSnippetForHash(textA);
  const normalizedB = normalizeSnippetForHash(textB);
  if (!normalizedA || !normalizedB) return 0;
  if (normalizedA === normalizedB) return 1;

  const gramsA = buildTrigramSet(normalizedA);
  const gramsB = buildTrigramSet(normalizedB);
  if (gramsA.size === 0 || gramsB.size === 0) return 0;

  let intersection = 0;
  for (const gram of gramsA) {
    if (gramsB.has(gram)) intersection += 1;
  }
  return intersection / Math.sqrt(gramsA.size * gramsB.size);
}

function buildTrigramSet(text: string): Set<string> {
  const grams = new Set<string>();
  for (let i = 0; i <= text.length - 3; i++) {
    grams.add(text.slice(i, i + 3));
  }
  return grams;
}

// ── Light sweep config defaults ────────────────────────────────────────

function resolveConfig(overrides?: Partial<DreamingLightConfig>): DreamingLightConfig {
  return {
    enabled: overrides?.enabled === true,
    cron: typeof overrides?.cron === 'string' ? overrides.cron : '0 */6 * * *',
    lookbackDays: Math.max(1, Math.floor(Number(overrides?.lookbackDays) || 2)),
    limit: Math.max(0, Math.floor(Number(overrides?.limit) || 100)),
    dedupeSimilarity: Math.max(0, Math.min(1, Number(overrides?.dedupeSimilarity) || 0.9)),
  };
}

// ── Core light sweep ───────────────────────────────────────────────────

type LightSweepChunk = {
  path: string;
  startLine: number;
  endLine: number;
  text: string;
  hash: string;
};

/**
 * Scan recent daily memory files (memory/YYYY-MM-DD.md) and collect signal
 * entries into the short-term store. Deduplicates near-identical snippets
 * using trigram similarity.
 *
 * This is the "light sleep" phase: fast, frequent, cheap.
 */
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

  if (!cfg.enabled) {
    await writeLastRun(params.workspaceDir, {
      runId, startedAt, cfg, ok: true, reason: 'light sweep disabled', startMs,
      light: { scannedEntries: 0, newSignals: 0, deduped: 0 },
    });
    return { ok: true, reason: 'light sweep disabled', scannedEntries: 0, newSignals: 0, deduped: 0 };
  }

  try {
    const memoryDir = path.join(params.workspaceDir, 'memory');
    const recentFiles = await listRecentDailyFiles(memoryDir, cfg.lookbackDays, now);

    if (recentFiles.length === 0) {
      await writeLastRun(params.workspaceDir, {
        runId, startedAt, cfg, ok: true, reason: 'no recent daily files', startMs,
        light: { scannedEntries: 0, newSignals: 0, deduped: 0 },
      });
      return { ok: true, reason: 'no recent daily files', scannedEntries: 0, newSignals: 0, deduped: 0 };
    }

    // Parse chunks from daily files.
    const allChunks: LightSweepChunk[] = [];
    for (const filePath of recentFiles) {
      const chunks = await parseFileChunks(filePath, params.workspaceDir);
      allChunks.push(...chunks);
    }

    if (allChunks.length === 0) {
      await writeLastRun(params.workspaceDir, {
        runId, startedAt, cfg, ok: true, reason: 'no chunks found in daily files', startMs,
        light: { scannedEntries: 0, newSignals: 0, deduped: 0 },
      });
      return { ok: true, reason: 'no chunks found in daily files', scannedEntries: 0, newSignals: 0, deduped: 0 };
    }

    // Deduplicate chunks by trigram similarity.
    const { unique, deduped } = deduplicateChunks(allChunks, cfg.dedupeSimilarity);
    const capped = unique.slice(0, cfg.limit);

    // Merge into the short-term store, bumping lightHits + dailyCount.
    const { store } = await loadDreamingStore({ workspaceDir: params.workspaceDir });
    let newSignals = 0;
    const dayBucket = isoDay(now);
    const nowIso = now.toISOString();

    for (const chunk of capped) {
      const key = buildEntryKey({ path: chunk.path, startLine: chunk.startLine, endLine: chunk.endLine });
      const existing = store.entries[key];

      if (existing) {
        bumpEntryPhaseSignal(existing, 'lightHits');
        bumpEntryPhaseSignal(existing, 'dailyCount');
        existing.snippet = chunk.text.slice(0, 360);
        existing.lastRecalledAt = nowIso;
      } else {
        store.entries[key] = {
          key,
          path: chunk.path,
          startLine: chunk.startLine,
          endLine: chunk.endLine,
          snippet: chunk.text.slice(0, 360),
          recallCount: 0,
          dailyCount: 1,
          groundedCount: 0,
          lightHits: 1,
          remHits: 0,
          phaseHitCount: 1,
          totalSignalCount: 1,
          totalScore: 0,
          maxScore: 0,
          queryHashes: [],
          recallDays: [dayBucket],
          firstRecalledAt: nowIso,
          lastRecalledAt: nowIso,
        };
        newSignals += 1;
      }
    }

    store.updatedAt = nowIso;
    await saveDreamingStore({ workspaceDir: params.workspaceDir, store });

    log.info(
      { workspaceDir: params.workspaceDir, scanned: allChunks.length, newSignals, deduped },
      'Light sweep complete',
    );

    await writeLastRun(params.workspaceDir, {
      runId, startedAt, cfg, ok: true, reason: 'light sweep complete', startMs,
      light: { scannedEntries: allChunks.length, newSignals, deduped },
    });

    return { ok: true, reason: 'light sweep complete', scannedEntries: allChunks.length, newSignals, deduped };
  } catch (err) {
    const errorMessage = err instanceof Error ? err.message : String(err);
    log.error({ err, errorMessage, workspaceDir: params.workspaceDir }, `Light sweep failed: ${errorMessage}`);
    await writeLastRun(params.workspaceDir, {
      runId, startedAt, cfg, ok: false, reason: `light sweep error: ${errorMessage}`, startMs,
      light: { scannedEntries: 0, newSignals: 0, deduped: 0 }, errorMessage,
    }).catch(() => undefined);
    return { ok: false, reason: errorMessage, scannedEntries: 0, newSignals: 0, deduped: 0 };
  }
}

// ── File scanning ──────────────────────────────────────────────────────

async function listRecentDailyFiles(memoryDir: string, lookbackDays: number, now: Date): Promise<string[]> {
  let entries: string[];
  try {
    entries = await fs.readdir(memoryDir);
  } catch (err) {
    if ((err as NodeJS.ErrnoException)?.code === 'ENOENT') return [];
    throw err;
  }

  const cutoff = new Date(now);
  cutoff.setDate(cutoff.getDate() - lookbackDays);
  const cutoffDay = isoDay(cutoff);

  return entries
    .filter((name) => isDailyMemoryFile(name))
    .filter((name) => {
      const day = name.replace(/\.md$/i, '');
      return day >= cutoffDay;
    })
    .sort()
    .map((name) => path.join(memoryDir, name));
}

async function parseFileChunks(filePath: string, workspaceDir: string): Promise<LightSweepChunk[]> {
  let raw: string;
  try {
    raw = await fs.readFile(filePath, 'utf-8');
  } catch {
    return [];
  }

  const relativePath = normalizeMemoryPath(path.relative(workspaceDir, filePath));
  const lines = raw.split(/\r?\n/);
  const chunks: LightSweepChunk[] = [];

  // Split into paragraph-level chunks (separated by blank lines).
  let chunkStartLine = 1;
  let currentLines: string[] = [];

  for (let i = 0; i < lines.length; i++) {
    const trimmed = lines[i]!.trim();
    if (trimmed.length === 0) {
      if (currentLines.length > 0) {
        const text = currentLines.join(' ').replace(/\s+/g, ' ').trim();
        if (text.length >= 20) {
          chunks.push({
            path: relativePath,
            startLine: chunkStartLine,
            endLine: chunkStartLine + currentLines.length - 1,
            text: text.slice(0, 360),
            hash: snippetHash(text),
          });
        }
        currentLines = [];
      }
      chunkStartLine = i + 2; // next non-blank line (1-indexed)
    } else {
      if (currentLines.length === 0) chunkStartLine = i + 1;
      currentLines.push(trimmed);
    }
  }

  // Flush remaining.
  if (currentLines.length > 0) {
    const text = currentLines.join(' ').replace(/\s+/g, ' ').trim();
    if (text.length >= 20) {
      chunks.push({
        path: relativePath,
        startLine: chunkStartLine,
        endLine: chunkStartLine + currentLines.length - 1,
        text: text.slice(0, 360),
        hash: snippetHash(text),
      });
    }
  }

  return chunks;
}

// ── Deduplication ──────────────────────────────────────────────────────

function deduplicateChunks(
  chunks: LightSweepChunk[],
  threshold: number,
): { unique: LightSweepChunk[]; deduped: number } {
  const unique: LightSweepChunk[] = [];
  let deduped = 0;

  for (const chunk of chunks) {
    const isDuplicate = unique.some(
      (existing) => existing.hash === chunk.hash || trigramSimilarity(existing.text, chunk.text) >= threshold,
    );
    if (isDuplicate) {
      deduped += 1;
    } else {
      unique.push(chunk);
    }
  }

  return { unique, deduped };
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
