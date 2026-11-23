import { createHash } from 'node:crypto';
import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs';
import { basename, join, resolve } from 'node:path';

import type { AutomationEvent } from '../automations/domain/types.js';
import { DurableState } from '../storage/sqlite/durable-state.js';
import { listUnderstandingSourceGrants } from '../user-context/sources/repository.js';
import { createLogger } from '../utils/logger.js';

const log = createLogger('ProactiveHub:LocalSignals');

const IGNORED_DIRS = new Set([
  '.git',
  'node_modules',
  'dist',
  'build',
  'out',
  '.next',
  '.cache',
  '.xopc',
]);

const IGNORED_FILES_RE = /^(?:\.DS_Store|Thumbs\.db|~\$.*|.*\.(?:tmp|swp|lock|part))$/iu;

interface FolderCursorState {
  fingerprint: string;
  files: Record<string, number>;
  updatedAt: number;
}

export interface WatchedFolderDescriptor {
  id: string;
  path: string;
  label: string;
  projectId?: string;
}

function scanDirectoryBounded(
  rootDir: string,
  maxDepth = 2,
  maxFiles = 200,
): Record<string, number> {
  const files: Record<string, number> = {};
  let count = 0;

  const walk = (currentDir: string, relativePrefix: string, depth: number) => {
    if (depth > maxDepth || count >= maxFiles) return;
    let entries;
    try {
      entries = readdirSync(currentDir, { withFileTypes: true });
    } catch {
      return;
    }
    for (const entry of entries) {
      if (count >= maxFiles) break;
      if (entry.isSymbolicLink()) continue;
      if (entry.isDirectory()) {
        if (IGNORED_DIRS.has(entry.name) || entry.name.startsWith('.')) continue;
        walk(join(currentDir, entry.name), relativePrefix ? `${relativePrefix}/${entry.name}` : entry.name, depth + 1);
      } else if (entry.isFile()) {
        if (IGNORED_FILES_RE.test(entry.name)) continue;
        const fullPath = join(currentDir, entry.name);
        try {
          const stat = statSync(fullPath);
          const relPath = relativePrefix ? `${relativePrefix}/${entry.name}` : entry.name;
          files[relPath] = Math.floor(stat.mtimeMs);
          count += 1;
        } catch {
          // Ignore transient vanished files.
        }
      }
    }
  };

  walk(rootDir, '', 0);
  return files;
}

function readGitHeadRef(repoRoot: string): string | null {
  const headPath = join(repoRoot, '.git', 'HEAD');
  if (!existsSync(headPath)) return null;
  try {
    const head = readFileSync(headPath, 'utf8').trim();
    if (!head.startsWith('ref:')) return head.slice(0, 40);
    const refRel = head.slice('ref:'.length).trim();
    const refPath = join(repoRoot, '.git', refRel);
    const sha = existsSync(refPath) ? readFileSync(refPath, 'utf8').trim().slice(0, 40) : 'unborn';
    return `${refRel}@${sha}`;
  } catch {
    return null;
  }
}

export function discoverAuthorizedWatchedFolders(extraFolders: readonly WatchedFolderDescriptor[] = []): WatchedFolderDescriptor[] {
  const discovered = new Map<string, WatchedFolderDescriptor>();

  for (const grant of listUnderstandingSourceGrants()) {
    if (grant.status !== 'active' || grant.processingPolicy === 'local_only') continue;
    const rawPath = typeof grant.config.path === 'string'
      ? grant.config.path
      : typeof grant.config.folderPath === 'string'
        ? grant.config.folderPath
        : undefined;
    if (!rawPath?.trim()) continue;
    const resolved = resolve(rawPath.trim());
    if (!existsSync(resolved)) continue;
    discovered.set(resolved, {
      id: grant.id,
      path: resolved,
      label: grant.displayName || basename(resolved),
    });
  }

  for (const folder of extraFolders) {
    const resolved = resolve(folder.path);
    if (!existsSync(resolved)) continue;
    discovered.set(resolved, { ...folder, path: resolved });
  }

  return [...discovered.values()];
}

/**
 * Emits bounded local folder and Git repository state signals for authorized directories
 * without streaming raw file contents into the event bus.
 */
export class LocalEnvironmentSignalProducer {
  private readonly cursors = new DurableState<FolderCursorState>('proactive.local-folder-cursors');
  private readonly gitCursors = new DurableState<string>('proactive.local-git-cursors');

  constructor(private readonly deps: {
    ingestEvent: (event: AutomationEvent) => void;
    extraFolders?: () => readonly WatchedFolderDescriptor[];
    now?: () => number;
  }) {}

  scanOnce(): number {
    const now = this.deps.now?.() ?? Date.now();
    const folders = discoverAuthorizedWatchedFolders(this.deps.extraFolders?.() ?? []);
    let emitted = 0;

    for (const folder of folders) {
      try {
        const snapshot = scanDirectoryBounded(folder.path);
        const fingerprint = createHash('sha256').update(JSON.stringify(snapshot)).digest('hex');
        const previous = this.cursors.get(folder.id);

        if (!previous) {
          // Baseline snapshot on first sight: record state without spamming historical files.
          this.cursors.set(folder.id, { fingerprint, files: snapshot, updatedAt: now });
        } else if (previous.fingerprint !== fingerprint) {
          const addedFiles: string[] = [];
          const modifiedFiles: string[] = [];
          for (const [relPath, mtime] of Object.entries(snapshot)) {
            if (previous.files[relPath] === undefined) addedFiles.push(relPath);
            else if (previous.files[relPath] !== mtime) modifiedFiles.push(relPath);
          }
          this.cursors.set(folder.id, { fingerprint, files: snapshot, updatedAt: now });

          if (addedFiles.length > 0 || modifiedFiles.length > 0) {
            this.deps.ingestEvent({
              id: `local:folder:${folder.id}:${fingerprint.slice(0, 16)}`,
              type: 'local.folder.batch_changed',
              source: 'local:folder',
              schemaVersion: 1,
              subject: { kind: 'folder', id: folder.id },
              occurredAtMs: now,
              dedupeKey: `${folder.id}:${fingerprint}`,
              trust: 'system',
              payload: {
                folderId: folder.id,
                folderName: folder.label,
                ...(folder.projectId ? { projectId: folder.projectId } : {}),
                addedFiles: addedFiles.slice(0, 20),
                modifiedFiles: modifiedFiles.slice(0, 20),
                totalChangedCount: addedFiles.length + modifiedFiles.length,
              },
            });
            emitted += 1;
          }
        }

        const gitHead = readGitHeadRef(folder.path);
        if (gitHead) {
          const priorHead = this.gitCursors.get(folder.id);
          if (!priorHead) {
            this.gitCursors.set(folder.id, gitHead);
          } else if (priorHead !== gitHead) {
            this.gitCursors.set(folder.id, gitHead);
            this.deps.ingestEvent({
              id: `local:git:${folder.id}:${createHash('sha256').update(gitHead).digest('hex').slice(0, 16)}`,
              type: 'local.git.repo_state_changed',
              source: 'local:git',
              schemaVersion: 1,
              subject: { kind: 'repository', id: folder.id },
              occurredAtMs: now,
              dedupeKey: `git:${folder.id}:${gitHead}`,
              trust: 'system',
              payload: {
                repositoryId: folder.id,
                repositoryName: folder.label,
                ...(folder.projectId ? { projectId: folder.projectId } : {}),
                previousHead: priorHead,
                currentHead: gitHead,
              },
            });
            emitted += 1;
          }
        }
      } catch (err) {
        log.debug({ err, folderId: folder.id, phase: 'local_signal_scan' }, 'Skipped unreadable watched folder');
      }
    }

    return emitted;
  }
}
