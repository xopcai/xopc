import { createHash } from 'node:crypto';
import { readFileSync, realpathSync } from 'node:fs';
import { isAbsolute, join, relative, resolve } from 'node:path';
import { z } from 'zod';

const Manifest = z.object({ version: z.literal(1), sdkVersion: z.literal('0.36.0'),
  platform: z.literal('darwin'), arch: z.enum(['arm64', 'x64']),
  binary: z.string().regex(/^[a-f0-9]{64}\/cua-driver$/), sha256: z.string().regex(/^[a-f0-9]{64}$/),
  sourceRevision: z.string().regex(/^[a-f0-9]{40}$/), sourceDirty: z.boolean(),
}).strict();

/** Development-only, explicit candidate selection; packaged releases never call this. */
export function resolveLocalComputerDriver(root: string, platform: NodeJS.Platform, arch: string): string {
  const local = resolve(root, '.cache/computer-driver/local');
  const manifest = Manifest.parse(JSON.parse(readFileSync(join(local, 'current.json'), 'utf8')));
  if (manifest.platform !== platform || manifest.arch !== arch) throw new Error('COMPUTER_LOCAL_DRIVER_PLATFORM_MISMATCH');
  const binary = realpathSync(join(local, manifest.binary));
  const within = relative(realpathSync(local), binary);
  if (within.startsWith('..') || isAbsolute(within) || createHash('sha256').update(readFileSync(binary)).digest('hex') !== manifest.sha256) {
    throw new Error('COMPUTER_LOCAL_DRIVER_CHECKSUM_MISMATCH');
  }
  return binary;
}
