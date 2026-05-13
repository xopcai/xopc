import fs from 'node:fs';
import { dirname, relative, resolve } from 'node:path';

import { formatSessionArchiveTimestamp } from './artifacts.js';
import { validateSessionId } from './session-id.js';

export type SessionFilePathOptions = {
  agentId?: string;
  sessionsDir?: string;
};

function resolveSessionsDir(opts?: SessionFilePathOptions): string {
  const sessionsDir = opts?.sessionsDir?.trim();
  if (!sessionsDir) {
    throw new Error('sessionsDir is required for session transcript path resolution');
  }
  return resolve(sessionsDir);
}

function resolvePathWithinSessionsDir(sessionsDir: string, candidate: string): string {
  const trimmed = candidate.trim();
  if (!trimmed) {
    throw new Error('Session file path must not be empty');
  }
  const resolvedBase = resolve(sessionsDir);
  const normalized = resolve(resolvedBase, trimmed);
  const rel = relative(resolvedBase, normalized);
  if (rel.startsWith('..') || rel === '') {
    throw new Error('Session file path must be within sessions directory');
  }
  return normalized;
}

export function resolveSessionTranscriptPathInDir(
  sessionId: string,
  sessionsDir: string,
  topicId?: string | number,
): string {
  const safeSessionId = validateSessionId(sessionId);
  const safeTopicId =
    typeof topicId === 'string'
      ? encodeURIComponent(topicId)
      : typeof topicId === 'number'
        ? String(topicId)
        : undefined;
  const fileName =
    safeTopicId !== undefined
      ? `${safeSessionId}-topic-${safeTopicId}.jsonl`
      : `${safeSessionId}.jsonl`;
  return resolvePathWithinSessionsDir(sessionsDir, fileName);
}

export function resolveSessionFilePath(
  sessionId: string,
  entry?: { sessionFile?: string },
  opts?: SessionFilePathOptions,
): string {
  const sessionsDir = resolveSessionsDir(opts);
  const candidate = entry?.sessionFile?.trim();
  if (candidate) {
    try {
      return resolvePathWithinSessionsDir(sessionsDir, candidate);
    } catch {
      /* fall through */
    }
  }
  return resolveSessionTranscriptPathInDir(sessionId, sessionsDir);
}

/**
 * Candidate transcript paths for a session (xopc state only — no external legacy dirs).
 */
export function resolveSessionTranscriptCandidates(
  sessionId: string,
  storePath: string | undefined,
  sessionFile?: string,
  _agentId?: string,
): string[] {
  const candidates: string[] = [];
  const push = (p: string): void => {
    if (!candidates.includes(p)) {
      candidates.push(p);
    }
  };

  if (storePath) {
    const sessionsDir = dirname(storePath);
    if (sessionFile?.trim()) {
      try {
        push(resolveSessionFilePath(sessionId, { sessionFile }, { sessionsDir }));
      } catch {
        /* ignore */
      }
    }
    push(resolveSessionTranscriptPathInDir(sessionId, sessionsDir));
  } else if (sessionFile?.trim()) {
    push(resolve(sessionFile.trim()));
  }

  return candidates;
}

export function archiveFileOnDisk(filePath: string, reason: 'reset' | 'deleted' | 'bak'): string {
  const ts = formatSessionArchiveTimestamp();
  const archived = `${filePath}.${reason}.${ts}`;
  fs.renameSync(filePath, archived);
  return archived;
}
