/**
 * Skill Watcher
 * 
 * Watches skill directories for changes and triggers reloads.
 * Inspired by openclaw's skills refresh system
 */

import { watch } from 'fs';
import { join } from 'path';
import { createLogger } from '../../utils/logger.js';
import type { SkillLoader } from './index.js';

const log = createLogger('SkillWatcher');

export interface SkillWatcherOptions {
  /** Debounce time in milliseconds */
  debounceMs?: number;
  /** Watch these directories */
  watchDirs: string[];
}

export interface SkillWatcher {
  /** Start watching */
  start: () => void;
  /** Stop watching */
  stop: () => void;
  /** Check if watching is active */
  isWatching: () => boolean;
  /** Get last refresh time */
  getLastRefreshTime: () => number;
}

/**
 * Create a debounced reload function
 */
function createDebouncedReload(
  loader: SkillLoader,
  debounceMs: number
): () => void {
  let timeout: NodeJS.Timeout | null = null;
  let pendingReload = false;

  return () => {
    if (timeout) {
      pendingReload = true;
      return;
    }

    timeout = setTimeout(() => {
      timeout = null;
      
      if (pendingReload) {
        pendingReload = false;
        loader.reload();
        log.info('Skills reloaded after directory changes');
      }
    }, debounceMs);
  };
}

/**
 * Create a skill watcher
 */
export function createSkillWatcher(
  loader: SkillLoader,
  options: SkillWatcherOptions
): SkillWatcher {
  const { watchDirs, debounceMs = 1000 } = options;
  
  const watchers: Array<{ watcher: ReturnType<typeof watch>; dir: string }> = [];
  const debouncedReload = createDebouncedReload(loader, debounceMs);
  let isWatching = false;
  let lastRefreshTime = Date.now();

  function watchDirectory(dir: string): void {
    try {
      const watcher = watch(dir, { recursive: true }, (eventType, filename) => {
        if (!filename) return;

        // Only care about SKILL.md files
        if (filename.toLowerCase() === 'skill.md') {
          log.debug({ eventType, filename, dir }, 'Skill file changed');
          lastRefreshTime = Date.now();
          debouncedReload();
        }

        // Also watch for new directories (potential new skills)
        if (eventType === 'rename') {
          log.debug({ eventType, filename, dir }, 'Directory changed, may be new skill');
          lastRefreshTime = Date.now();
          debouncedReload();
        }
      });

      watchers.push({ watcher, dir });
      log.info({ dir }, 'Watching skill directory');
    } catch (err) {
      log.warn({ dir, error: err }, 'Failed to watch skill directory');
    }
  }

  return {
    start: () => {
      if (isWatching) {
        log.warn('Watcher already started');
        return;
      }

      for (const dir of watchDirs) {
        watchDirectory(dir);
      }

      isWatching = true;
      log.info({ dirs: watchDirs }, 'Skill watcher started');
    },

    stop: () => {
      if (!isWatching) {
        return;
      }

      for (const { watcher } of watchers) {
        watcher.close();
      }

      watchers.length = 0;
      isWatching = false;
      log.info('Skill watcher stopped');
    },

    isWatching: () => isWatching,

    getLastRefreshTime: () => lastRefreshTime,
  };
}

/**
 * Create a skill watcher from loader configuration
 */
export function createWatcherFromLoader(
  loader: SkillLoader,
  options: {
    workspaceDir?: string;
    builtinDir?: string;
    globalDirs?: string[];
    extraDirs?: string[];
    debounceMs?: number;
  }
): SkillWatcher | null {
  const watchDirs: string[] = [];

  // Add workspace skills directory
  if (options.workspaceDir) {
    const workspaceSkillsDir = join(options.workspaceDir, 'skills');
    watchDirs.push(workspaceSkillsDir);
  }

  // Add builtin directory
  if (options.builtinDir) {
    watchDirs.push(options.builtinDir);
  }

  // Add global directories
  if (options.globalDirs) {
    watchDirs.push(...options.globalDirs);
  }

  // Add extra directories
  if (options.extraDirs) {
    watchDirs.push(...options.extraDirs);
  }

  if (watchDirs.length === 0) {
    log.warn('No directories to watch');
    return null;
  }

  return createSkillWatcher(loader, {
    watchDirs,
    debounceMs: options.debounceMs ?? 1000,
  });
}
