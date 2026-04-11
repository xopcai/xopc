/**
 * Copy workspace root MEMORY.md into the default agent's curated memory file
 * (`~/.xopcbot/agents/<id>/memories/MEMORY.md`) when missing or empty.
 *
 * Usage: `pnpm exec tsx scripts/migrate-memory.ts [workspaceDir]`
 * Env: `XOPCBOT_WORKSPACE` if no argument (source root for MEMORY.md only).
 */

import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

import { resolveAgentHomeDir, resolveDefaultAgentId } from '../src/agents/agent-scope.js';
import { loadConfig } from '../src/config/loader.js';

const srcRoot =
  process.argv[2]?.trim() ||
  process.env.XOPCBOT_WORKSPACE?.trim() ||
  process.cwd();

const cfg = loadConfig();
const agentId = resolveDefaultAgentId(cfg);
const destDir = join(resolveAgentHomeDir(cfg, agentId), 'memories');
const src = join(srcRoot, 'MEMORY.md');
const dest = join(destDir, 'MEMORY.md');

if (!existsSync(src)) {
  console.log(`No ${src}; nothing to migrate.`);
  process.exit(0);
}

const raw = readFileSync(src, 'utf-8');
const content = raw.trim();
if (!content) {
  console.log('Workspace MEMORY.md is empty; nothing to migrate.');
  process.exit(0);
}

mkdirSync(destDir, { recursive: true });

if (existsSync(dest)) {
  const existing = readFileSync(dest, 'utf-8').trim();
  if (existing.length > 0) {
    console.error(
      `${dest} already has content; not overwriting. Merge or delete it first.`,
    );
    process.exit(1);
  }
}

writeFileSync(dest, `${content}\n`, 'utf-8');
console.log(`Migrated ${src} -> ${dest}`);
