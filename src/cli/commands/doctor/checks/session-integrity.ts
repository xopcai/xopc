import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { basename, join } from 'node:path';

import { listAgentEntries, resolveDefaultAgentId } from '../../../../agent/agent-scope.js';
import { loadConfig } from '../../../../config/loader.js';
import type { Config } from '../../../../config/schema.js';
import { FILENAMES, resolveSessionsDir } from '../../../../config/paths.js';
import { parseSessionKey } from '../../../../routing/session-key.js';
import { resolveSessionFilePath } from '../../../../session/parity/transcript-paths.js';
import type { XopcSessionDiskEntry } from '../../../../session/parity/xopc-session-disk-entry.js';
import type { CheckResult, DoctorContext } from '../types.js';

interface SessionMapLocation {
  agentId: string;
  sessionsDir: string;
  mapPath: string;
}

function discoverSessionMapLocations(config: Config, stateDir: string): SessionMapLocation[] {
  const agentIds = new Set<string>([
    resolveDefaultAgentId(config),
    ...listAgentEntries(config).map((agent) => agent.id),
  ]);

  const agentsRoot = join(stateDir, 'agents');
  if (existsSync(agentsRoot)) {
    for (const entry of readdirSync(agentsRoot, { withFileTypes: true })) {
      if (entry.isDirectory()) {
        agentIds.add(entry.name);
      }
    }
  }

  const seenMapPaths = new Set<string>();
  const locations: SessionMapLocation[] = [];
  for (const agentId of agentIds) {
    const sessionsDir = resolveSessionsDir(config, agentId);
    const mapPath = join(sessionsDir, FILENAMES.SESSIONS_MAP);
    if (seenMapPaths.has(mapPath)) {
      continue;
    }
    seenMapPaths.add(mapPath);
    locations.push({ agentId, sessionsDir, mapPath });
  }
  return locations;
}

function readSessionMap(mapPath: string): Record<string, XopcSessionDiskEntry> {
  const parsed = JSON.parse(readFileSync(mapPath, 'utf-8')) as unknown;
  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
    throw new Error('invalid sessions map');
  }
  return parsed as Record<string, XopcSessionDiskEntry>;
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

  let config: Config;
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

  const locations = discoverSessionMapLocations(config, ctx.stateDir);
  const missingMaps: string[] = [];
  const invalidMaps: string[] = [];
  const missingTranscripts: string[] = [];
  const agentMismatches: string[] = [];
  const orphanTranscripts: string[] = [];
  let sessionCount = 0;

  for (const location of locations) {
    if (!existsSync(location.sessionsDir)) {
      continue;
    }
    if (!existsSync(location.mapPath)) {
      missingMaps.push(location.mapPath);
      continue;
    }

    let map: Record<string, XopcSessionDiskEntry>;
    try {
      map = readSessionMap(location.mapPath);
    } catch {
      invalidMaps.push(location.mapPath);
      continue;
    }

    const referencedTranscriptFiles = new Set<string>();
    for (const [sessionKey, entry] of Object.entries(map)) {
      sessionCount++;
      const parsed = parseSessionKey(sessionKey);
      if (parsed && parsed.agentId !== location.agentId) {
        agentMismatches.push(`${sessionKey} in agent ${location.agentId}`);
      }
      if (!entry?.sessionId) {
        missingTranscripts.push(sessionKey);
        continue;
      }
      try {
        const transcriptPath = resolveSessionFilePath(entry.sessionId, entry, { sessionsDir: location.sessionsDir });
        referencedTranscriptFiles.add(basename(transcriptPath));
        if (!existsSync(transcriptPath)) {
          missingTranscripts.push(sessionKey);
        }
      } catch {
        missingTranscripts.push(sessionKey);
      }
    }

    for (const file of readdirSync(location.sessionsDir, { withFileTypes: true })) {
      if (!file.isFile() || !file.name.endsWith('.jsonl') || file.name.includes('.checkpoint.')) {
        continue;
      }
      if (!referencedTranscriptFiles.has(file.name)) {
        orphanTranscripts.push(join(location.sessionsDir, file.name));
      }
    }
  }

  const hints = [
    ...missingMaps.slice(0, 3).map((path) => `Missing sessions.json: ${path}`),
    ...invalidMaps.slice(0, 3).map((path) => `Invalid sessions.json: ${path}`),
    ...agentMismatches.slice(0, 3).map((item) => `Session key agent mismatch: ${item}`),
    ...missingTranscripts.slice(0, 3).map((key) => `Missing transcript for: ${key}`),
    ...orphanTranscripts.slice(0, 3).map((path) => `Orphan transcript: ${path}`),
  ];

  const warningCount =
    missingMaps.length + invalidMaps.length + missingTranscripts.length + agentMismatches.length + orphanTranscripts.length;

  if (warningCount > 0) {
    return {
      id: 'session-integrity',
      label: 'Sessions',
      status: 'warn',
      message: `Scanned ${locations.length} agent session dir(s), ${sessionCount} session(s); found ${warningCount} issue(s).`,
      hints,
    };
  }

  return {
    id: 'session-integrity',
    label: 'Sessions',
    status: 'pass',
    message: `Scanned ${locations.length} agent session dir(s), ${sessionCount} session(s); session maps and JSONL transcripts are consistent.`,
    hints: [],
  };
}
