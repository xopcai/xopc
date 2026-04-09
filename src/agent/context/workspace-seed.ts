/**
 * Seed Markdown workspace bootstrap files (OpenClaw-style `ensureAgentWorkspace` + `writeFileIfMissing`).
 * Templates ship under `./workspace-templates/` next to this module (also copied to `dist/` at build).
 */

import { copyFileSync, existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { WORKSPACE_FILES } from '../../config/paths.js';
import { BOOTSTRAP_FILES } from './workspace.js';
import { createLogger } from '../../utils/logger.js';

const log = createLogger('WorkspaceSeed');

/** Files to copy when seeding a new agent workspace (includes `BOOTSTRAP.md`, not part of system-prompt load order). */
const SEED_FILENAMES: readonly string[] = [...BOOTSTRAP_FILES, WORKSPACE_FILES.BOOTSTRAP];

const __dirname = dirname(fileURLToPath(import.meta.url));

function resolveBundledTemplatesDir(): string {
  return join(__dirname, 'workspace-templates');
}

/**
 * Development fallback: repo `docs/reference/templates` when bundled dir is missing (e.g. partial checkout).
 */
function resolveFallbackTemplatesDir(): string | null {
  let dir = __dirname;
  for (let i = 0; i < 8; i++) {
    const candidate = join(dir, 'docs', 'reference', 'templates');
    if (existsSync(candidate)) {
      return candidate;
    }
    const parent = dirname(dir);
    if (parent === dir) break;
    dir = parent;
  }
  return null;
}

function readTemplate(name: string): string | null {
  const bundled = join(resolveBundledTemplatesDir(), name);
  if (existsSync(bundled)) {
    return readFileSync(bundled, 'utf-8');
  }
  const fallback = resolveFallbackTemplatesDir();
  if (fallback) {
    const p = join(fallback, name);
    if (existsSync(p)) {
      return readFileSync(p, 'utf-8');
    }
  }
  return null;
}

function writeFileIfMissing(targetPath: string, content: string): boolean {
  if (existsSync(targetPath)) {
    return false;
  }
  writeFileSync(targetPath, content, 'utf-8');
  return true;
}

/**
 * Create `workspaceDir` and copy any missing bootstrap Markdown files from built-in templates.
 * Does not overwrite existing files (per-agent persona stays independent after first edit).
 */
export function seedWorkspaceBootstrapFiles(workspaceDir: string): void {
  mkdirSync(workspaceDir, { recursive: true });

  let seeded = 0;
  for (const name of SEED_FILENAMES) {
    const targetPath = join(workspaceDir, name);
    const tpl = readTemplate(name);
    if (!tpl) {
      log.warn({ name }, 'Missing workspace template file; skip seeding');
      continue;
    }
    if (writeFileIfMissing(targetPath, tpl)) {
      seeded++;
    }
  }

  if (seeded > 0) {
    log.info({ workspaceDir, seeded }, 'Seeded workspace bootstrap files');
  }
}

/**
 * Copy bootstrap files from another workspace. When `overwrite` is false, only writes if the target is missing.
 */
export function copyBootstrapFilesFromWorkspace(
  sourceDir: string,
  targetDir: string,
  opts?: { overwrite?: boolean },
): void {
  mkdirSync(targetDir, { recursive: true });
  const overwrite = opts?.overwrite === true;
  for (const name of SEED_FILENAMES) {
    const from = join(sourceDir, name);
    const to = join(targetDir, name);
    if (!existsSync(from)) {
      continue;
    }
    if (overwrite || !existsSync(to)) {
      copyFileSync(from, to);
    }
  }
}
