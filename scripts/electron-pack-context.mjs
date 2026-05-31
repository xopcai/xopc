/**
 * Isolate electron-builder from the pnpm monorepo during packaging.
 *
 * Primary isolation: `out/electron-pack` staging + beforeBuild=false (see prepare-electron-pack-dir.mjs).
 * We also hide pnpm workspace markers so extraResources / lockfile-based tooling do not treat
 * the repo as an active workspace mid-pack.
 */
import { existsSync, renameSync } from 'node:fs';
import { join } from 'node:path';

/** Hidden for the duration of electron-builder (restored in finally). */
export const PNPM_WORKSPACE_MARKER_FILES = ['pnpm-lock.yaml', 'pnpm-workspace.yaml'];

/**
 * @param {string} root Repo root
 * @returns {Array<{ name: string; src: string; bak: string }>}
 */
export function hidePnpmWorkspaceMarkers(root) {
  const backups = [];
  for (const name of PNPM_WORKSPACE_MARKER_FILES) {
    const src = join(root, name);
    if (!existsSync(src)) continue;
    const bak = join(root, `.electron-pack-${name}.bak`);
    if (existsSync(bak)) {
      throw new Error(
        `[electron-pack] Stale backup ${bak} exists — a previous electron pack may have been interrupted. Remove it and retry.`,
      );
    }
    renameSync(src, bak);
    backups.push({ name, src, bak });
  }
  if (backups.length > 0) {
    console.log(
      `[electron-pack] Temporarily hid ${backups.map((b) => b.name).join(', ')} (pnpm workspace isolation)`,
    );
  }
  return backups;
}

/**
 * @param {Array<{ src: string; bak: string }>} backups
 */
export function restorePnpmWorkspaceMarkers(backups) {
  for (const { src, bak } of [...backups].reverse()) {
    if (existsSync(src)) continue;
    if (!existsSync(bak)) {
      throw new Error(`[electron-pack] Missing backup ${bak} while restoring ${src}`);
    }
    renameSync(bak, src);
  }
}

/**
 * @param {string} root
 * @param {() => number | void | Promise<number | void>} run
 */
export function withElectronPackContext(root, run) {
  const markerBackups = hidePnpmWorkspaceMarkers(root);

  try {
    return run();
  } finally {
    restorePnpmWorkspaceMarkers(markerBackups);
  }
}
