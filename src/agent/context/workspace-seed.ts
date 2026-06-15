/**
 * Seed profile Markdown files into `agents/<agentId>/profile/` (and optionally `git init` the Markdown workspace).
 * Resolution order per file: `XOPC_TEMPLATE_PATH` or repo `docs/reference/templates`, then bundled `./workspace-templates/`.
 */

import { execFileSync } from 'node:child_process';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

import type { Config } from '../../config/schema.js';
import { DEFAULT_AGENT_ID, resolveAgentProfileDir, resolveAgentWorkspaceDir } from '../agent-scope.js';
import { WORKSPACE_FILES } from '../../config/paths.js';
import { AGENT_PROFILE_MARKDOWN_SYSTEM_FILES } from './workspace.js';
import { createLogger } from '../../utils/logger.js';
import {
  markBootstrapSeeded,
  resolveWorkspaceStatePathForMarkdownWorkspace,
} from './workspace-state.js';

const log = createLogger('WorkspaceSeed');

/** Marker in bundled/reference `IDENTITY.md` templates; replaced on agent creation when a display name is known. */
export const IDENTITY_NAME_PLACEHOLDER = '_(pick something you like)_';

export type SeedWorkspaceProfileMarkdownOptions = {
  /** Fills the **Name** line in `IDENTITY.md` when the template still contains the placeholder. */
  displayName?: string;
};

/** Files to copy when seeding a new agent (includes `BOOTSTRAP.md`, not part of system-prompt load order). */
const SEED_FILENAMES: readonly string[] = [...AGENT_PROFILE_MARKDOWN_SYSTEM_FILES, WORKSPACE_FILES.BOOTSTRAP];

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
 * Seed profile Markdown into `profileDir` (`agents/<id>/profile/`).
 * When `markdownWorkspaceDir` is set, runs `git init` on a brand-new Markdown workspace only (never under `profile/`).
 * Does not overwrite existing files.
 */
export function seedAgentProfileMarkdownFiles(
  profileDir: string,
  markdownWorkspaceDir: string,
  options?: SeedWorkspaceProfileMarkdownOptions,
): void {
  const wsPreExisted = existsSync(markdownWorkspaceDir);
  mkdirSync(profileDir, { recursive: true });
  mkdirSync(markdownWorkspaceDir, { recursive: true });

  const isBrandNewWorkspace = !wsPreExisted;

  let seeded = 0;
  for (const name of SEED_FILENAMES) {
    const targetPath = join(profileDir, name);
    const tpl = readTemplate(name);
    if (!tpl) {
      log.warn({ name }, 'Missing workspace template file; skip seeding');
      continue;
    }
    const body =
      name === WORKSPACE_FILES.IDENTITY ? personalizeIdentityTemplate(tpl, options?.displayName) : tpl;
    if (writeFileIfMissing(targetPath, body)) {
      seeded++;
      // Track bootstrap seeding in workspace state
      if (name === WORKSPACE_FILES.BOOTSTRAP) {
        markBootstrapSeeded(resolveWorkspaceStatePathForMarkdownWorkspace(markdownWorkspaceDir));
      }
    }
  }

  if (seeded > 0) {
    log.info({ profileDir, seeded }, 'Seeded profile Markdown files');
  }

  ensureGitRepo(markdownWorkspaceDir, isBrandNewWorkspace);
}

/** Attempt `git init` on a brand-new Markdown workspace; silently skip on failure. */
function ensureGitRepo(markdownWorkspaceDir: string, isBrandNew: boolean): void {
  if (!isBrandNew) {
    return;
  }
  if (existsSync(join(markdownWorkspaceDir, '.git'))) {
    return;
  }
  try {
    execFileSync('git', ['init'], { cwd: markdownWorkspaceDir, stdio: 'ignore', timeout: 5_000 });
    log.info({ markdownWorkspaceDir }, 'Initialized git repo in Markdown workspace');
  } catch {
    log.debug({ markdownWorkspaceDir }, 'git init skipped (git not available or failed)');
  }
}

/**
 * Ensure default (`main`) agent has reference profile Markdown templates (missing files only).
 */
export function seedMainAgentProfileMarkdown(cfg: Config): void {
  seedAgentProfileMarkdownFiles(
    resolveAgentProfileDir(cfg, DEFAULT_AGENT_ID),
    resolveAgentWorkspaceDir(cfg, DEFAULT_AGENT_ID),
  );
}