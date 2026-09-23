import { createHash } from 'node:crypto';
import { readFileSync, readdirSync } from 'node:fs';
import { basename, join, relative } from 'node:path';

const EXCLUDED_NAMES = new Set(['.git', 'node_modules', '.DS_Store']);

export function shouldCopyLocalAppPath(path: string): boolean {
  return !EXCLUDED_NAMES.has(basename(path));
}

export function hashLocalAppDirectory(root: string): string {
  const hash = createHash('sha256');
  const visit = (dir: string): void => {
    const entries = readdirSync(dir, { withFileTypes: true })
      .filter((entry) => !EXCLUDED_NAMES.has(entry.name))
      .toSorted((a, b) => a.name.localeCompare(b.name));
    for (const entry of entries) {
      const path = join(dir, entry.name);
      const relativePath = relative(root, path);
      hash.update(relativePath);
      if (entry.isDirectory()) visit(path);
      else if (entry.isFile()) hash.update(readFileSync(path));
      else throw new Error(`Unsupported local app entry: ${relativePath}`);
    }
  };
  visit(root);
  return hash.digest('hex');
}

export function localAppFileHashes(root: string): Map<string, string> {
  const hashes = new Map<string, string>();
  const visit = (dir: string): void => {
    const entries = readdirSync(dir, { withFileTypes: true })
      .filter((entry) => !EXCLUDED_NAMES.has(entry.name))
      .toSorted((a, b) => a.name.localeCompare(b.name));
    for (const entry of entries) {
      const path = join(dir, entry.name);
      const relativePath = relative(root, path);
      if (entry.isDirectory()) visit(path);
      else if (entry.isFile()) hashes.set(relativePath, createHash('sha256').update(readFileSync(path)).digest('hex'));
      else throw new Error(`Unsupported local app entry: ${relativePath}`);
    }
  };
  visit(root);
  return hashes;
}
