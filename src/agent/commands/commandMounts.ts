import { lstatSync, readdirSync } from 'node:fs';
import { join, relative, sep } from 'node:path';

import { containsBlockedCredentialSegment, getBlockedPaths } from '../sandbox/path-policy.js';

/** Mask credentials and multiply-linked files, including those below writable mounts. */
export function credentialMounts(workspace: string): string[] {
  const args: string[] = [];
  const protectedPaths = new Set(getBlockedPaths());
  let entries = 0;
  const visit = (directory: string) => {
    for (const entry of readdirSync(directory, { withFileTypes: true })) {
      if (++entries > 200_000) throw new Error('Workspace exceeds safe container mount scan limit');
      const path = join(directory, entry.name);
      const destination = `/workspace/${relative(workspace, path).split(sep).join('/')}`;
      const sensitive = entry.name === '.xopc' || protectedPaths.has(path.split(sep).join('/')) || containsBlockedCredentialSegment(destination);
      const linked = entry.isFile() && lstatSync(path).nlink > 1;
      if (sensitive || linked) {
        if (destination.includes(',') || destination.includes(':')) throw new Error('Unsupported sensitive path in container workspace');
        // Docker may follow a symlink mount target; reject it instead of masking another path.
        if (entry.isSymbolicLink()) throw new Error('Sensitive symlinks must be removed from the container workspace');
        if (entry.isDirectory()) args.push('--tmpfs', `${destination}:ro,nosuid,nodev,noexec,size=4k,mode=000`);
        else if (entry.isFile()) args.push('--mount', `type=bind,source=/dev/null,target=${destination},readonly`);
        else throw new Error('Unsupported sensitive file in container workspace');
      } else if (entry.isDirectory()) visit(path);
      else if (!entry.isFile() && !entry.isSymbolicLink()) throw new Error('Container workspace must not contain sockets, devices or FIFOs');
    }
  };
  visit(workspace);
  if (args.length > 4096) throw new Error('Too many sensitive paths in container workspace');
  return args;
}
