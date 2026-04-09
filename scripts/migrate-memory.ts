/**
 * One-time migration: copy workspace root MEMORY.md into `.xopcbot/memories/MEMORY.md`
 * when the curated file is missing or empty.
 *
 * Usage: `pnpm exec tsx scripts/migrate-memory.ts [workspaceDir]`
 * Env: `XOPCBOT_WORKSPACE` if no argument.
 */

import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

const workspace =
  process.argv[2]?.trim() ||
  process.env.XOPCBOT_WORKSPACE?.trim() ||
  process.cwd();

const src = join(workspace, 'MEMORY.md');
const destDir = join(workspace, '.xopcbot', 'memories');
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
