import { existsSync, lstatSync, realpathSync } from 'node:fs';
import { dirname, isAbsolute, relative, resolve } from 'node:path';

export function containedPath(root: string, path: string): string {
  const base = resolve(root);
  const target = resolve(path);
  const rel = relative(base, target);
  if (rel === '..' || rel.startsWith(`..${process.platform === 'win32' ? '\\' : '/'}`) || isAbsolute(rel)) {
    throw new Error('Path escapes package boundary');
  }
  // Resolve existing ancestors as well as leaves: PLUGIN_DATA may not exist yet.
  let ancestor = target;
  while (!existsSync(ancestor)) {
    try { lstatSync(ancestor); throw new Error('Broken package symlink'); } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error;
    }
    if (dirname(ancestor) === ancestor) break;
    ancestor = dirname(ancestor);
  }
  let baseAncestor = base;
  while (!existsSync(baseAncestor)) baseAncestor = dirname(baseAncestor);
  const canonicalBase = resolve(realpathSync(baseAncestor), relative(baseAncestor, base));
  const canonicalTarget = resolve(realpathSync(ancestor), relative(ancestor, target));
  const resolvedRelative = relative(canonicalBase, canonicalTarget);
  if (resolvedRelative === '..' || resolvedRelative.startsWith('../') || resolvedRelative.startsWith('..\\') || isAbsolute(resolvedRelative)) {
    throw new Error('Resolved path escapes package boundary');
  }
  return canonicalTarget;
}
