import { createHash } from 'node:crypto';
import { existsSync, readFileSync, realpathSync, statSync } from 'node:fs';
import { extname, posix, relative, resolve, sep } from 'node:path';

import { DurableState } from '../storage/sqlite/durable-state.js';
import { localAppFileHashes } from './artifact-files.js';

const PUBLIC_TYPES = new Set(['.html', '.js', '.mjs', '.css', '.json', '.svg', '.png', '.jpg', '.jpeg', '.gif', '.webp', '.ico', '.woff', '.woff2', '.ttf']);

export function recordPublicAssets(appId: string, sourceHash: string, root: string, entrypoint: string): void {
  const uiDir = posix.dirname(entrypoint.replaceAll('\\', '/'));
  if (uiDir === '.' || uiDir.split(/[\\/]/).some(part => part.startsWith('.'))) throw new Error('Local app UI must use a dedicated public directory');
  const assets = Object.fromEntries([...localAppFileHashes(root)]
    .map(([path, hash]) => [path.split(sep).join('/'), hash])
    .filter(([path]) => path.startsWith(`${uiDir}/`) && !path.split('/').some(part => part.startsWith('.')) && PUBLIC_TYPES.has(extname(path).toLowerCase())));
  new DurableState('local-app-public-assets', appId).set(sourceHash, assets);
}

export function resolvePublicAsset(appId: string, sourceHash: string, root: string, path: string): string | null {
  const assets = new DurableState<Record<string, string>>('local-app-public-assets', appId).get(sourceHash);
  if (!assets || !Object.hasOwn(assets, path)) return null;
  const target = resolve(root, path);
  if (!existsSync(target)) return null;
  const real = realpathSync(target);
  const rel = relative(realpathSync(root), real);
  if (rel.startsWith('..') || rel === '' || !statSync(real).isFile()) return null;
  if (createHash('sha256').update(readFileSync(real)).digest('hex') !== assets[path]) return null;
  return real;
}
