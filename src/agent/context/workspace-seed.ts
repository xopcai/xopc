/**
 * Seed bootstrap persona Markdown files under `…/agents/<id>/bootstrap/` (ensure workspace + write-if-missing).
 * Resolution order per file: `XOPC_TEMPLATE_PATH` or repo `docs/reference/templates`, then bundled `./workspace-templates/`.
 */

import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

import type { Config } from '../../config/schema.js';
import { DEFAULT_AGENT_ID, resolveAgentBootstrapDir } from '../agent-scope.js';
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

/**
 * Create `bootstrapDir` and copy any missing bootstrap Markdown files from built-in templates.
 * Does not overwrite existing files (per-agent persona stays independent after first edit).
 */
export function seedWorkspaceBootstrapFiles(bootstrapDir: string): void {
  mkdirSync(bootstrapDir, { recursive: true });

  let seeded = 0;
  for (const name of SEED_FILENAMES) {
    const targetPath = join(bootstrapDir, name);
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
    log.info({ bootstrapDir, seeded }, 'Seeded bootstrap Markdown files');
  }
}

/**
 * Ensure default (`main`) agent bootstrap has the same reference templates as the markdown workspace (missing files only).
 */
export function seedMainAgentBootstrap(cfg: Config): void {
  seedWorkspaceBootstrapFiles(resolveAgentBootstrapDir(cfg, DEFAULT_AGENT_ID));
}
