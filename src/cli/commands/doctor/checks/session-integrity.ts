import { existsSync, readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';

import { resolveDefaultAgentId } from '../../../../agent/agent-scope.js';
import { loadConfig } from '../../../../config/loader.js';
import { resolveSessionsDir, resolveSessionsIndexPath } from '../../../../config/paths.js';
import { resolveSessionShardRelativePath } from '../../../../session/shard-path.js';
import type { SessionIndex, SessionMetadata } from '../../../../session/types.js';
import type { CheckResult, DoctorContext } from '../types.js';

function sanitizeSessionKeyToFileStem(key: string): string {
  return key.replace(/[^a-zA-Z0-9_-]/g, '_');
}

function findSessionFileInDir(baseDir: string, safeStem: string): boolean {
  if (!existsSync(baseDir)) return false;
  const entries = readdirSync(baseDir, { withFileTypes: true });
  for (const entry of entries) {
    if (entry.isFile() && entry.name === `${safeStem}.json`) return true;
    if (entry.isDirectory() && entry.name !== 'archive') {
      if (findSessionFileInDir(join(baseDir, entry.name), safeStem)) return true;
    }
  }
  return false;
}

function transcriptExists(sessionsDir: string, key: string): boolean {
  const safeStem = sanitizeSessionKeyToFileStem(key);
  const shard = resolveSessionShardRelativePath(key);
  const primary = join(sessionsDir, shard, `${safeStem}.json`);
  if (existsSync(primary)) return true;
  return findSessionFileInDir(sessionsDir, safeStem);
}

export async function checkSessionIntegrity(ctx: DoctorContext): Promise<CheckResult> {
  if (!ctx.options.deep) {
    return {
      id: 'session-integrity',
      label: 'Sessions',
      status: 'skip',
      message: 'Deep mode off; session scan skipped.',
      hints: ['Run: xopc doctor --deep'],
    };
  }

  if (!existsSync(ctx.configPath)) {
    return {
      id: 'session-integrity',
      label: 'Sessions',
      status: 'skip',
      message: 'No config file; skipped.',
      hints: [],
    };
  }

  let config;
  try {
    config = loadConfig(ctx.configPath);
  } catch {
    return {
      id: 'session-integrity',
      label: 'Sessions',
      status: 'skip',
      message: 'Config could not be loaded; skipped.',
      hints: [],
    };
  }

  const agentId = resolveDefaultAgentId(config);
  const indexPath = resolveSessionsIndexPath(config, agentId);
  const sessionsDir = resolveSessionsDir(config, agentId);

  if (!existsSync(sessionsDir)) {
    return {
      id: 'session-integrity',
      label: 'Sessions',
      status: 'warn',
      message: 'Sessions directory is missing.',
      hints: [sessionsDir],
    };
  }

  if (!existsSync(indexPath)) {
    return {
      id: 'session-integrity',
      label: 'Sessions',
      status: 'warn',
      message: 'Session index file is missing.',
      hints: [indexPath],
    };
  }

  let index: SessionIndex;
  try {
    index = JSON.parse(readFileSync(indexPath, 'utf-8')) as SessionIndex;
  } catch {
    return {
      id: 'session-integrity',
      label: 'Sessions',
      status: 'warn',
      message: 'Session index is not valid JSON.',
      hints: [indexPath],
    };
  }

  const sessions: SessionMetadata[] = Array.isArray(index.sessions) ? index.sessions : [];
  const sorted = [...sessions].sort(
    (a, b) => new Date(b.updatedAt).getTime() - new Date(a.updatedAt).getTime(),
  );
  const sample = sorted.slice(0, 20);
  if (sample.length === 0) {
    return {
      id: 'session-integrity',
      label: 'Sessions',
      status: 'pass',
      message: 'Session index is valid; no sessions to sample.',
      hints: [],
    };
  }

  const missing: string[] = [];
  for (const s of sample) {
    const key = s.key?.trim();
    if (!key) continue;
    if (!transcriptExists(sessionsDir, key)) {
      missing.push(key);
    }
  }

  if (missing.length > 0) {
    return {
      id: 'session-integrity',
      label: 'Sessions',
      status: 'warn',
      message: `${missing.length} of ${sample.length} sampled session transcripts are missing on disk.`,
      hints: missing.slice(0, 5).map((k) => `Missing transcript for: ${k}`),
    };
  }

  return {
    id: 'session-integrity',
    label: 'Sessions',
    status: 'pass',
    message: `Sampled ${sample.length} recent session(s); transcript files are present.`,
    hints: [],
  };
}
