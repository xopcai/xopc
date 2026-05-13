import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';

import { resolveDefaultAgentId } from '../../../../agent/agent-scope.js';
import { loadConfig } from '../../../../config/loader.js';
import { FILENAMES, resolveSessionsDir } from '../../../../config/paths.js';
import { resolveSessionFilePath } from '../../../../session/parity/transcript-paths.js';
import type { XopcSessionDiskEntry } from '../../../../session/parity/xopc-session-disk-entry.js';
import type { CheckResult, DoctorContext } from '../types.js';

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
  const sessionsDir = resolveSessionsDir(config, agentId);
  const mapPath = join(sessionsDir, FILENAMES.SESSIONS_MAP);

  if (!existsSync(sessionsDir)) {
    return {
      id: 'session-integrity',
      label: 'Sessions',
      status: 'warn',
      message: 'Sessions directory is missing.',
      hints: [sessionsDir],
    };
  }

  if (!existsSync(mapPath)) {
    return {
      id: 'session-integrity',
      label: 'Sessions',
      status: 'warn',
      message: '`sessions.json` is missing.',
      hints: [mapPath],
    };
  }

  let map: Record<string, XopcSessionDiskEntry>;
  try {
    const parsed = JSON.parse(readFileSync(mapPath, 'utf-8')) as unknown;
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
      throw new Error('invalid');
    }
    map = parsed as Record<string, XopcSessionDiskEntry>;
  } catch {
    return {
      id: 'session-integrity',
      label: 'Sessions',
      status: 'warn',
      message: '`sessions.json` is not valid JSON.',
      hints: [mapPath],
    };
  }

  const keys = Object.keys(map);
  const sorted = [...keys].sort((a, b) => {
    const ta = map[a]?.updatedAt ?? 0;
    const tb = map[b]?.updatedAt ?? 0;
    return tb - ta;
  });
  const sample = sorted.slice(0, 20);
  if (sample.length === 0) {
    return {
      id: 'session-integrity',
      label: 'Sessions',
      status: 'pass',
      message: '`sessions.json` is valid; no sessions to sample.',
      hints: [],
    };
  }

  const missing: string[] = [];
  for (const sessionKey of sample) {
    const entry = map[sessionKey];
    if (!entry?.sessionId) {
      missing.push(sessionKey);
      continue;
    }
    try {
      const p = resolveSessionFilePath(entry.sessionId, entry, { sessionsDir });
      if (!existsSync(p)) {
        missing.push(sessionKey);
      }
    } catch {
      missing.push(sessionKey);
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
    message: `Sampled ${sample.length} recent session(s); JSONL transcripts are present.`,
    hints: [],
  };
}
