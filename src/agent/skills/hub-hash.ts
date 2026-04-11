/**
 * Deterministic content hash for a skill directory (for hub lock / drift detection).
 */

import { createHash } from 'node:crypto';
import { createReadStream } from 'node:fs';
import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs';
import { join, relative } from 'node:path';

const SKIP_DIR = new Set(['.git', 'node_modules']);

function collectRelativeFiles(root: string): string[] {
  const out: string[] = [];

  function walk(dir: string): void {
    let entries;
    try {
      entries = readdirSync(dir, { withFileTypes: true });
    } catch {
      return;
    }
    for (const e of entries) {
      const full = join(dir, e.name);
      if (e.isDirectory()) {
        if (SKIP_DIR.has(e.name)) continue;
        walk(full);
      } else if (e.isFile()) {
        out.push(relative(root, full).split('\\').join('/'));
      }
    }
  }

  walk(root);
  return out.sort();
}

/** Hash file contents without loading huge trees into one buffer (streaming per file). */
function sha256File(path: string): Promise<string> {
  return new Promise((resolve, reject) => {
    const hash = createHash('sha256');
    const stream = createReadStream(path);
    stream.on('data', (chunk: Buffer | string) => hash.update(chunk));
    stream.on('error', reject);
    stream.on('end', () => resolve(hash.digest('hex')));
  });
}

/**
 * Stable hash: sorted relative paths, each file hashed; final digest over `path\\0hex\\n` lines.
 */
export async function computeSkillTreeHash(skillDir: string): Promise<string> {
  const root = skillDir;
  if (!existsSync(root) || !statSync(root).isDirectory()) {
    return createHash('sha256').update('').digest('hex');
  }

  const rels = collectRelativeFiles(root);
  const aggregate = createHash('sha256');
  for (const rel of rels) {
    const full = join(root, rel);
    const fh = await sha256File(full);
    aggregate.update(`${rel}\0${fh}\n`);
  }
  return aggregate.digest('hex');
}

/** Sync variant for CLI paths that are already small trees. */
export function computeSkillTreeHashSync(skillDir: string): string {
  const root = skillDir;
  if (!existsSync(root) || !statSync(root).isDirectory()) {
    return createHash('sha256').update('').digest('hex');
  }

  const rels = collectRelativeFiles(root);
  const aggregate = createHash('sha256');
  for (const rel of rels) {
    const full = join(root, rel);
    const buf = readFileSync(full);
    const fh = createHash('sha256').update(buf).digest('hex');
    aggregate.update(`${rel}\0${fh}\n`);
  }
  return aggregate.digest('hex');
}
