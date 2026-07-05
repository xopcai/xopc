import { isAbsolute, join, relative, resolve } from 'node:path';

import { resolveStateDir } from '../config/paths-state.js';

import type { MediaBucket } from './types.js';

/** Global media store root: `{stateDir}/media/`. */
export function getMediaDir(): string {
  return join(resolveStateDir(), 'media');
}

export function getMediaBucketDir(bucket: MediaBucket): string {
  return join(getMediaDir(), bucket);
}

export function isPathInside(root: string, candidate: string): boolean {
  const rootResolved = resolve(root);
  const candidateResolved = resolve(candidate);
  const rel = relative(rootResolved, candidateResolved);
  return rel === '' || (!rel.startsWith('..') && !isAbsolute(rel));
}
