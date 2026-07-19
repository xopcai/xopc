import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  renameSync,
  rmSync,
} from 'node:fs';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';

import { installExtensionFromStoreZip } from './install.js';

interface ExtensionManifestEntry {
  id?: string;
  main?: string;
}

export interface StagedExtensionInstall {
  extensionId: string;
  stagingRoot: string;
  stagedExtensionDir: string;
  targetDir: string;
  backupDir?: string;
  committed: boolean;
}

/** Extract, validate, install dependencies, and import-check an extension away from its live path. */
export async function stageExtensionStoreZip(
  buffer: Buffer,
  extensionsDir: string,
): Promise<StagedExtensionInstall> {
  mkdirSync(extensionsDir, { recursive: true });
  const stagingRoot = mkdtempSync(join(extensionsDir, '.xopc-install-'));

  try {
    const result = await installExtensionFromStoreZip(buffer, stagingRoot);
    if (!result.ok || !result.extensionId || !result.targetDir) {
      throw new Error(result.error ?? 'Extension staging failed');
    }

    const manifestPath = join(result.targetDir, 'xopc.extension.json');
    const manifest = JSON.parse(readFileSync(manifestPath, 'utf8')) as ExtensionManifestEntry;
    if (!manifest.main) {
      throw new Error('Extension manifest must declare main');
    }

    const mainUrl = pathToFileURL(join(result.targetDir, manifest.main));
    mainUrl.searchParams.set('xopcInstallCheck', `${Date.now()}-${Math.random()}`);
    await import(mainUrl.href);

    return {
      extensionId: result.extensionId,
      stagingRoot,
      stagedExtensionDir: result.targetDir,
      targetDir: join(extensionsDir, result.extensionId),
      committed: false,
    };
  } catch (err) {
    rmSync(stagingRoot, { recursive: true, force: true });
    throw err;
  }
}

/** Move a staged extension into its live path, preserving the previous version for rollback. */
export function commitStagedExtensionInstall(
  state: StagedExtensionInstall,
  overwrite: boolean,
): void {
  if (existsSync(state.targetDir)) {
    if (!overwrite) {
      throw new Error(`Extension already exists at ${state.targetDir}. Use overwrite to replace it.`);
    }
    state.backupDir = join(state.stagingRoot, 'previous');
    renameSync(state.targetDir, state.backupDir);
  }

  try {
    renameSync(state.stagedExtensionDir, state.targetDir);
    state.committed = true;
  } catch (err) {
    if (state.backupDir && existsSync(state.backupDir) && !existsSync(state.targetDir)) {
      renameSync(state.backupDir, state.targetDir);
      state.backupDir = undefined;
    }
    throw err;
  }
}

/** Restore the previous live extension, or remove a newly committed install. */
export function rollbackStagedExtensionInstall(state: StagedExtensionInstall): void {
  if (state.committed && existsSync(state.targetDir)) {
    rmSync(state.targetDir, { recursive: true, force: true });
  }
  if (state.backupDir && existsSync(state.backupDir)) {
    renameSync(state.backupDir, state.targetDir);
  }
  state.committed = false;
  rmSync(state.stagingRoot, { recursive: true, force: true });
}

/** Delete the preserved previous version after every durable metadata write succeeds. */
export function finalizeStagedExtensionInstall(state: StagedExtensionInstall): void {
  rmSync(state.stagingRoot, { recursive: true, force: true });
  state.backupDir = undefined;
}
