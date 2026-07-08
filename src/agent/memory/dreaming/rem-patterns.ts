import fs from 'node:fs/promises';
import path from 'node:path';

import { createLogger } from '../../../utils/logger.js';
import { DREAMING_DIR_RELATIVE, DREAMS_MD_FILENAME, MS_PER_DAY } from './constants.js';
import type { DreamingRemConfig } from './config.js';
import {
  bumpEntryPhaseSignal,
  loadDreamingStore,
  saveDreamingStore,
  type DreamingStoreEntry,
} from './short-term-store.js';
import { isoDay } from './utils.js';
import {
  DREAMING_LAST_RUN_FORMAT_VERSION,
  type DreamingRemLastRun,
} from './last-run.js';

const log = createLogger('Dreaming:REM');

// ── Pattern types ──────────────────────────────────────────────────────

type PatternCluster = {
  representative: DreamingStoreEntry;
  members: DreamingStoreEntry[];
  strength: number;
  /** Shared query hashes across members. */
  sharedQueries: string[];
  /** Distinct source files involved. */
  distinctPaths: string[];
};

// ── Config defaults ────────────────────────────────────────────────────

function resolveConfig(overrides?: Partial<DreamingRemConfig>): DreamingRemConfig {
  return {
    enabled: overrides?.enabled === true,
    cron: typeof overrides?.cron === 'string' ? overrides.cron : '0 5 * * 0',
    lookbackDays: Math.max(1, Math.floor(Number(overrides?.lookbackDays) || 7)),
    limit: Math.max(0, Math.floor(Number(overrides?.limit) || 10)),
    minPatternStrength: Math.max(0, Math.min(1, Number(overrides?.minPatternStrength) || 0.75)),
  };
}

// ── Core REM pattern discovery ─────────────────────────────────────────

/**
 * REM phase: cross-session pattern discovery.
 *
 * Scans the short-term store for entries that share query hashes or
 * appear across multiple indexed memory sources, then clusters them to identify
 * recurring themes/patterns. Bumps `remHits` on touched entries and
 * optionally writes a pattern summary to DREAMS.md.
 *
 * Runs weekly; expensive but insightful.
 */
export async function runRemPatterns(params: {
  dreamingRoot: string;
  config?: Partial<DreamingRemConfig>;
  now?: Date;
}): Promise<{
  ok: boolean;
  reason: string;
  patternsDiscovered: number;
  entriesAnalyzed: number;
}> {
  const cfg = resolveConfig(params.config);
  const now = params.now ?? new Date();
  const startedAt = now.toISOString();
  const runId = `rem:${startedAt}:${process.pid}`;
  const startMs = Date.now();
  const nowMs = now.getTime();

  if (!cfg.enabled) {
    await writeLastRun(params.dreamingRoot, {
      runId, startedAt, cfg, ok: true, reason: 'REM patterns disabled', startMs,
      rem: { patternsDiscovered: 0, entriesAnalyzed: 0 },
    });
    return { ok: true, reason: 'REM patterns disabled', patternsDiscovered: 0, entriesAnalyzed: 0 };
  }

  try {
    const { store } = await loadDreamingStore({ dreamingRoot: params.dreamingRoot });

    // Filter entries within the lookback window.
    const cutoffMs = nowMs - cfg.lookbackDays * MS_PER_DAY;
    const recentEntries = Object.values(store.entries ?? {}).filter(
      (entry): entry is DreamingStoreEntry => {
        if (!entry || typeof entry !== 'object') return false;
        if (!entry.lastRecalledAt) return false;
        const lastMs = Date.parse(entry.lastRecalledAt);
        return Number.isFinite(lastMs) && lastMs >= cutoffMs;
      },
    );

    if (recentEntries.length < 2) {
      await writeLastRun(params.dreamingRoot, {
        runId, startedAt, cfg, ok: true, reason: 'not enough recent entries for pattern analysis', startMs,
        rem: { patternsDiscovered: 0, entriesAnalyzed: recentEntries.length },
      });
      return {
        ok: true,
        reason: 'not enough recent entries for pattern analysis',
        patternsDiscovered: 0,
        entriesAnalyzed: recentEntries.length,
      };
    }

    // Discover patterns by clustering entries that share query hashes.
    const clusters = discoverPatternClusters(recentEntries, cfg.minPatternStrength);
    const topClusters = clusters.slice(0, cfg.limit);

    // Bump remHits on all entries that belong to a discovered pattern.
    const touchedKeys = new Set<string>();
    for (const cluster of topClusters) {
      for (const member of cluster.members) {
        if (!touchedKeys.has(member.key)) {
          touchedKeys.add(member.key);
          const storeEntry = store.entries[member.key];
          if (storeEntry) {
            bumpEntryPhaseSignal(storeEntry, 'remHits');
          }
        }
      }
    }

    store.updatedAt = now.toISOString();
    await saveDreamingStore({ dreamingRoot: params.dreamingRoot, store });

    // Write pattern summary to DREAMS.md (append).
    if (topClusters.length > 0) {
      await appendPatternSummary(params.dreamingRoot, topClusters, now);
    }

    log.info(
      {
        dreamingRoot: params.dreamingRoot,
        patterns: topClusters.length,
        entriesAnalyzed: recentEntries.length,
        touched: touchedKeys.size,
      },
      'REM pattern discovery complete',
    );

    await writeLastRun(params.dreamingRoot, {
      runId, startedAt, cfg, ok: true, reason: 'REM patterns complete', startMs,
      rem: { patternsDiscovered: topClusters.length, entriesAnalyzed: recentEntries.length },
    });

    return {
      ok: true,
      reason: 'REM patterns complete',
      patternsDiscovered: topClusters.length,
      entriesAnalyzed: recentEntries.length,
    };
  } catch (err) {
    const errorMessage = err instanceof Error ? err.message : String(err);
    log.error({ err, errorMessage, dreamingRoot: params.dreamingRoot }, `REM pattern discovery failed: ${errorMessage}`);
    await writeLastRun(params.dreamingRoot, {
      runId, startedAt, cfg, ok: false, reason: `REM error: ${errorMessage}`, startMs,
      rem: { patternsDiscovered: 0, entriesAnalyzed: 0 }, errorMessage,
    }).catch(() => undefined);
    return { ok: false, reason: errorMessage, patternsDiscovered: 0, entriesAnalyzed: 0 };
  }
}

// ── Pattern clustering ─────────────────────────────────────────────────

/**
 * Build an inverted index of queryHash → entries, then form clusters
 * where multiple entries share overlapping query hashes. Each cluster's
 * "strength" is the ratio of shared queries to total unique queries.
 */
function discoverPatternClusters(
  entries: DreamingStoreEntry[],
  minStrength: number,
): PatternCluster[] {
  // Build inverted index: queryHash → entry keys.
  const hashToEntries = new Map<string, DreamingStoreEntry[]>();
  for (const entry of entries) {
    for (const queryHash of entry.queryHashes ?? []) {
      const group = hashToEntries.get(queryHash);
      if (group) {
        group.push(entry);
      } else {
        hashToEntries.set(queryHash, [entry]);
      }
    }
  }

  // Find query hashes that appear in 2+ distinct entries from different paths.
  const significantHashes: Array<{ hash: string; entries: DreamingStoreEntry[] }> = [];
  for (const [hash, group] of hashToEntries) {
    const uniquePaths = new Set(group.map((e) => e.path));
    if (group.length >= 2 && uniquePaths.size >= 2) {
      significantHashes.push({ hash, entries: group });
    }
  }

  if (significantHashes.length === 0) return [];

  // Merge overlapping groups into clusters using union-find.
  const keyToCluster = new Map<string, Set<string>>();
  const keyToEntry = new Map<string, DreamingStoreEntry>();

  for (const entry of entries) {
    keyToEntry.set(entry.key, entry);
  }

  for (const { entries: groupEntries } of significantHashes) {
    const keys = groupEntries.map((e) => e.key);
    // Find or create the cluster for the first key.
    let mergedCluster = keyToCluster.get(keys[0]!);
    if (!mergedCluster) {
      mergedCluster = new Set<string>();
      mergedCluster.add(keys[0]!);
      keyToCluster.set(keys[0]!, mergedCluster);
    }
    // Merge all other keys into this cluster.
    for (const key of keys.slice(1)) {
      const existingCluster = keyToCluster.get(key);
      if (existingCluster && existingCluster !== mergedCluster) {
        for (const existingKey of existingCluster) {
          mergedCluster.add(existingKey);
          keyToCluster.set(existingKey, mergedCluster);
        }
      } else {
        mergedCluster.add(key);
        keyToCluster.set(key, mergedCluster);
      }
    }
  }

  // Deduplicate cluster sets.
  const seenClusters = new Set<Set<string>>();
  const rawClusters: Set<string>[] = [];
  for (const cluster of keyToCluster.values()) {
    if (!seenClusters.has(cluster) && cluster.size >= 2) {
      seenClusters.add(cluster);
      rawClusters.push(cluster);
    }
  }

  // Score each cluster.
  const scoredClusters: PatternCluster[] = [];
  for (const clusterKeys of rawClusters) {
    const members: DreamingStoreEntry[] = [];
    for (const key of clusterKeys) {
      const entry = keyToEntry.get(key);
      if (entry) members.push(entry);
    }
    if (members.length < 2) continue;

    // Shared queries: hashes that appear in 2+ members.
    const hashCounts = new Map<string, number>();
    for (const member of members) {
      for (const hash of member.queryHashes ?? []) {
        hashCounts.set(hash, (hashCounts.get(hash) ?? 0) + 1);
      }
    }
    const sharedQueries = [...hashCounts.entries()]
      .filter(([, count]) => count >= 2)
      .map(([hash]) => hash);

    const allUniqueHashes = new Set<string>();
    for (const member of members) {
      for (const hash of member.queryHashes ?? []) allUniqueHashes.add(hash);
    }

    const strength = allUniqueHashes.size > 0 ? sharedQueries.length / allUniqueHashes.size : 0;
    if (strength < minStrength) continue;

    const distinctPaths = [...new Set(members.map((m) => m.path))];

    // Representative: the member with the highest totalSignalCount.
    const representative = members.reduce((best, current) =>
      (current.totalSignalCount ?? 0) > (best.totalSignalCount ?? 0) ? current : best,
    );

    scoredClusters.push({
      representative,
      members,
      strength,
      sharedQueries,
      distinctPaths,
    });
  }

  // Sort by strength descending, then by member count.
  scoredClusters.sort((a, b) => {
    if (b.strength !== a.strength) return b.strength - a.strength;
    return b.members.length - a.members.length;
  });

  return scoredClusters;
}

// ── DREAMS.md writer ───────────────────────────────────────────────────

async function appendPatternSummary(
  dreamingRoot: string,
  clusters: PatternCluster[],
  now: Date,
): Promise<void> {
  const dreamsPath = path.join(dreamingRoot, DREAMS_MD_FILENAME);
  const existing = await fs.readFile(dreamsPath, 'utf-8').catch((err: unknown) => {
    if ((err as NodeJS.ErrnoException)?.code === 'ENOENT') return '';
    throw err;
  });

  const day = isoDay(now);
  const lines: string[] = [];

  if (existing.trim().length === 0) {
    lines.push('# Dream Diary', '');
  }

  lines.push(`## REM Pattern Discovery — ${day}`, '');
  lines.push(`*${now.toISOString()}*`, '');

  for (let i = 0; i < clusters.length; i++) {
    const cluster = clusters[i]!;
    lines.push(
      `### Pattern ${i + 1}: ${cluster.distinctPaths.length} files, strength=${cluster.strength.toFixed(2)}`,
    );
    lines.push('');
    lines.push(`**Files involved:** ${cluster.distinctPaths.join(', ')}`);
    lines.push(`**Shared query themes:** ${cluster.sharedQueries.length} overlapping queries`);
    lines.push(`**Members:** ${cluster.members.length} snippets`);
    lines.push('');
    // Include the representative snippet.
    const rep = cluster.representative;
    lines.push(`> ${rep.snippet?.slice(0, 200) ?? '(no snippet)'}`);
    lines.push(`> — ${rep.path}:${rep.startLine}-${rep.endLine}`);
    lines.push('');
  }

  lines.push('---', '');

  const separator = existing.trim().length > 0 && !existing.endsWith('\n') ? '\n' : '';
  const next = `${existing}${separator}${lines.join('\n')}`;
  await fs.writeFile(dreamsPath, next, 'utf-8');
}

// ── Last-run writer ────────────────────────────────────────────────────

async function writeLastRun(
  dreamingRoot: string,
  params: {
    runId: string;
    startedAt: string;
    cfg: DreamingRemConfig;
    ok: boolean;
    reason: string;
    startMs: number;
    rem: DreamingRemLastRun['rem'];
    errorMessage?: string;
  },
): Promise<void> {
  const finishedAt = new Date().toISOString();
  const durationMs = Math.max(0, Date.now() - params.startMs);

  const lastRun: DreamingRemLastRun = {
    version: DREAMING_LAST_RUN_FORMAT_VERSION,
    phase: 'rem',
    runId: params.runId,
    startedAt: params.startedAt,
    finishedAt,
    durationMs,
    ok: params.ok,
    reason: params.reason,
    config: params.cfg,
    rem: params.rem,
    ...(params.errorMessage ? { errorMessage: params.errorMessage } : {}),
  };

  const lastRunPath = path.join(dreamingRoot, DREAMING_DIR_RELATIVE, 'last-run-rem.json');
  await fs.mkdir(path.dirname(lastRunPath), { recursive: true });
  const tmp = `${lastRunPath}.${process.pid}.${Date.now()}.tmp`;
  await fs.writeFile(tmp, `${JSON.stringify(lastRun, null, 2)}\n`, 'utf-8');
  await fs.rename(tmp, lastRunPath);
}
