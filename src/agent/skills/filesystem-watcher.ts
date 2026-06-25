import path from 'node:path';

import chokidar, { type FSWatcher } from 'chokidar';

import { resolveSkillsDir, resolveStateDir } from '../../config/paths.js';
import { createLogger } from '../../utils/logger.js';
import { createSkillConfigManager } from './config.js';
import { isManagedSkillTransientDirName } from './managed-store.js';
import { resolveWorkspaceSkillsDir } from './workspace-skills-dir.js';

const log = createLogger('SkillFilesystemWatcher');

export interface SkillFilesystemWatcherOptions {
  onChange: (event: { reason: 'watch'; changedPath?: string }) => void;
}

type WatchTarget = {
  key: string;
  root: string;
  kind: 'global' | 'workspace';
  watcher: FSWatcher;
  timer?: NodeJS.Timeout;
  pendingPath?: string;
};

const DEFAULT_DEBOUNCE_MS = 1000;
const WATCH_DEPTH = 8;
const IGNORED_SEGMENTS = new Set([
  '.git',
  'node_modules',
  'dist',
  'build',
  '.next',
  '.nuxt',
  '.venv',
  'venv',
  '__pycache__',
  '.cache',
  '.mypy_cache',
  '.pytest_cache',
]);

function normalizePath(p: string): string {
  return path.resolve(p);
}

function pathSegments(p: string): string[] {
  return p.split(/[\\/]+/).filter(Boolean);
}

function hasIgnoredSegment(p: string): boolean {
  return pathSegments(p).some(
    (segment) => IGNORED_SEGMENTS.has(segment) || isManagedSkillTransientDirName(segment),
  );
}

function isSameOrInside(parent: string, child: string): boolean {
  const rel = path.relative(parent, child);
  return rel === '' || (!!rel && !rel.startsWith('..') && !path.isAbsolute(rel));
}

function isWorkspaceSkillPath(workspaceRoot: string, candidate: string): boolean {
  const skillsRoot = resolveWorkspaceSkillsDir(workspaceRoot);
  return (
    candidate === workspaceRoot ||
    isSameOrInside(skillsRoot, candidate) ||
    isSameOrInside(candidate, skillsRoot)
  );
}

function isWorkspaceSkillsRoot(workspaceRoot: string, candidate: string): boolean {
  return candidate === resolveWorkspaceSkillsDir(workspaceRoot);
}

function isSkillMdPath(candidate: string): boolean {
  return path.basename(candidate).toLowerCase() === 'skill.md';
}

function readWatcherConfig(): { enabled: boolean; debounceMs: number } {
  const cfg = createSkillConfigManager(resolveStateDir()).load();
  const rawDebounce = cfg.load?.watchDebounceMs;
  return {
    enabled: cfg.load?.watch !== false,
    debounceMs:
      typeof rawDebounce === 'number' && Number.isFinite(rawDebounce)
        ? Math.max(0, rawDebounce)
        : DEFAULT_DEBOUNCE_MS,
  };
}

export class SkillFilesystemWatcher {
  private readonly targets = new Map<string, WatchTarget>();
  private readonly onChange: SkillFilesystemWatcherOptions['onChange'];
  private disposed = false;

  constructor(options: SkillFilesystemWatcherOptions) {
    this.onChange = options.onChange;
    this.watchGlobalSkillsDir();
  }

  watchGlobalSkillsDir(): void {
    this.watchRoot(resolveSkillsDir(), 'global');
  }

  watchWorkspace(workspaceDir: string): void {
    const resolved = normalizePath(workspaceDir);
    if (!resolved) return;
    this.watchRoot(resolved, 'workspace');
  }

  refreshPrimaryWorkspace(workspaceDir: string): void {
    this.watchGlobalSkillsDir();
    this.watchWorkspace(workspaceDir);
  }

  dispose(): void {
    this.disposed = true;
    for (const target of this.targets.values()) {
      if (target.timer) clearTimeout(target.timer);
      void target.watcher.close().catch((err) => {
        log.warn({ err, root: target.root }, 'Skill watcher close failed');
      });
    }
    this.targets.clear();
  }

  private watchRoot(root: string, kind: WatchTarget['kind']): void {
    if (this.disposed) return;
    const { enabled, debounceMs } = readWatcherConfig();
    const resolvedRoot = normalizePath(root);
    const key = `${kind}:${resolvedRoot}`;

    if (!enabled) {
      this.unwatch(key);
      return;
    }

    const existing = this.targets.get(key);
    if (existing) return;

    const ignored = (watchPath: string, stats?: { isDirectory?: () => boolean }) => {
      const candidate = normalizePath(watchPath);
      if (candidate === resolvedRoot) return false;
      if (hasIgnoredSegment(candidate)) return true;

      if (kind === 'workspace' && !isWorkspaceSkillPath(resolvedRoot, candidate)) {
        return true;
      }

      if (kind === 'workspace' && isWorkspaceSkillsRoot(resolvedRoot, candidate)) return false;
      if (!stats) return false;
      if (stats?.isDirectory?.()) return false;
      return !isSkillMdPath(candidate);
    };

    const watcher = chokidar.watch(resolvedRoot, {
      ignoreInitial: true,
      followSymlinks: false,
      depth: WATCH_DEPTH,
      awaitWriteFinish: {
        stabilityThreshold: debounceMs,
        pollInterval: 100,
      },
      ignored,
    });

    const target: WatchTarget = { key, root: resolvedRoot, kind, watcher };
    const schedule = (changedPath?: string) => this.scheduleRefresh(target, changedPath);

    watcher.on('addDir', schedule);
    watcher.on('add', schedule);
    watcher.on('change', schedule);
    watcher.on('unlink', schedule);
    watcher.on('unlinkDir', schedule);
    watcher.on('error', (err) => {
      log.warn({ err, root: resolvedRoot, kind }, 'Skill watcher error');
    });

    this.targets.set(key, target);
    log.info({ root: resolvedRoot, kind }, 'Watching skill filesystem');
  }

  private unwatch(key: string): void {
    const target = this.targets.get(key);
    if (!target) return;
    if (target.timer) clearTimeout(target.timer);
    void target.watcher.close().catch((err) => {
      log.warn({ err, root: target.root }, 'Skill watcher close failed');
    });
    this.targets.delete(key);
  }

  private scheduleRefresh(target: WatchTarget, changedPath?: string): void {
    const { enabled, debounceMs } = readWatcherConfig();
    if (!enabled) {
      this.unwatch(target.key);
      return;
    }

    target.pendingPath = changedPath ?? target.pendingPath;
    if (target.timer) clearTimeout(target.timer);
    target.timer = setTimeout(() => {
      target.timer = undefined;
      const pendingPath = target.pendingPath;
      target.pendingPath = undefined;
      this.onChange({ reason: 'watch', changedPath: pendingPath });
    }, debounceMs);
  }
}
