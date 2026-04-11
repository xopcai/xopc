/**
 * One-time migration of agent internal files from markdown workspace to agent home / agent dir.
 */

import { existsSync } from 'node:fs';
import { cpSync, mkdirSync, renameSync } from 'node:fs';
import { dirname } from 'node:path';

export function migrateFileIfMissing(target: string, source: string): void {
  if (existsSync(target) || !existsSync(source)) {
    return;
  }
  mkdirSync(dirname(target), { recursive: true });
  cpSync(source, target);
}

/** Move a directory tree when the destination does not exist yet. */
export function migrateTreeIfTargetMissing(targetDir: string, sourceDir: string): void {
  if (!existsSync(sourceDir) || existsSync(targetDir)) {
    return;
  }
  mkdirSync(dirname(targetDir), { recursive: true });
  renameSync(sourceDir, targetDir);
}
