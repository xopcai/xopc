/**
 * Seed bootstrap persona Markdown files into the workspace root (OpenClaw-aligned).
 * Resolution order per file: `XOPC_TEMPLATE_PATH` or repo `docs/reference/templates`, then bundled `./workspace-templates/`.
 */

import { execFileSync } from 'node:child_process';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

import type { Config } from '../../config/schema.js';
import { DEFAULT_AGENT_ID, resolveAgentWorkspaceDir } from '../agent-scope.js';
import { WORKSPACE_FILES } from '../../config/paths.js';
import { BOOTSTRAP_FILES } from './workspace.js';
import { createLogger } from '../../utils/logger.js';

const log = createLogger('WorkspaceSeed');

/** Marker in bundled/reference `IDENTITY.md` templates; replaced on agent creation when a display name is known. */
export const IDENTITY_NAME_PLACEHOLDER = '_(pick something you like)_';

export type SeedWorkspaceBootstrapOptions = {
  /** Fills the **Name** line in `IDENTITY.md` when the template still contains the placeholder. */
  displayName?: string;
};

/** Files to copy when seeding a new agent workspace (includes `BOOTSTRAP.md`, not part of system-prompt load order). */
const SEED_FILENAMES: readonly string[] = [...BOOTSTRAP_FILES, WORKSPACE_FILES.BOOTSTRAP];

const __dirname = dirname(fileURLToPath(import.meta.url));

function resolveBundledTemplatesDir(): string {
  return join(__dirname, 'workspace-templates');
}

/** Walk ancestors for `docs/reference/templates` (dev checkout or local install with docs). */
function resolveDocsTemplatesDirFromWalk(): string | null {
  let dir = __dirname;
  for (let i = 0; i < 12; i++) {
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

/** Same convention as CLI `templates.ts`: env override, then docs tree, else null. */
function resolvePrimaryTemplatesBaseDir(): string | null {
  const envPath = process.env.XOPC_TEMPLATE_PATH?.trim();
  if (envPath && existsSync(envPath)) {
    return envPath;
  }
  return resolveDocsTemplatesDirFromWalk();
}

function readTemplate(name: string): string | null {
  const primary = resolvePrimaryTemplatesBaseDir();
  if (primary) {
    const p = join(primary, name);
    if (existsSync(p)) {
      return readFileSync(p, 'utf-8');
    }
  }
  const bundled = join(resolveBundledTemplatesDir(), name);
  if (existsSync(bundled)) {
    return readFileSync(bundled, 'utf-8');
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

function personalizeIdentityTemplate(content: string, displayName?: string): string {
  const n = displayName?.trim();
  if (!n || !content.includes(IDENTITY_NAME_PLACEHOLDER)) {
    return content;
  }
  return content.replaceAll(IDENTITY_NAME_PLACEHOLDER, n);
}

/**
 * OpenClaw-aligned: seed bootstrap persona Markdown files into the workspace root.
 * Does not overwrite existing files (per-agent persona stays independent after first edit).
 * On a brand-new workspace, also attempts `git init` (silently skips when git is unavailable).
 */
export function seedWorkspaceBootstrapFiles(
  workspaceDir: string,
  options?: SeedWorkspaceBootstrapOptions,
): void {
  const isBrandNew = !existsSync(workspaceDir);
  mkdirSync(workspaceDir, { recursive: true });

  let seeded = 0;
  for (const name of SEED_FILENAMES) {
    const targetPath = join(workspaceDir, name);
    const tpl = readTemplate(name);
    if (!tpl) {
      log.warn({ name }, 'Missing workspace template file; skip seeding');
      continue;
    }
    const body =
      name === WORKSPACE_FILES.IDENTITY ? personalizeIdentityTemplate(tpl, options?.displayName) : tpl;
    if (writeFileIfMissing(targetPath, body)) {
      seeded++;
    }
  }

  if (seeded > 0) {
    log.info({ workspaceDir, seeded }, 'Seeded bootstrap Markdown files');
  }

  ensureGitRepo(workspaceDir, isBrandNew);
}

/** Attempt `git init` on a brand-new workspace; silently skip on failure. */
function ensureGitRepo(workspaceDir: string, isBrandNew: boolean): void {
  if (!isBrandNew) {
    return;
  }
  if (existsSync(join(workspaceDir, '.git'))) {
    return;
  }
  try {
    execFileSync('git', ['init'], { cwd: workspaceDir, stdio: 'ignore', timeout: 5_000 });
    log.info({ workspaceDir }, 'Initialized git repo in workspace');
  } catch {
    log.debug({ workspaceDir }, 'git init skipped (git not available or failed)');
  }
}

/**
 * Ensure default (`main`) agent bootstrap has the same reference templates as the markdown workspace (missing files only).
 */
/**
 * Ensure default agent workspace has bootstrap reference templates (missing files only).
 * OpenClaw-aligned: bootstrap files live in the workspace root directory.
 */
export function seedMainAgentBootstrap(cfg: Config): void {
  seedWorkspaceBootstrapFiles(resolveAgentWorkspaceDir(cfg, DEFAULT_AGENT_ID));
}
