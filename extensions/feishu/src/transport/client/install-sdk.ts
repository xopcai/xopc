import { statSync } from 'node:fs';
import { mkdir, mkdtemp, rename, rm } from 'node:fs/promises';
import { createRequire } from 'node:module';
import { join } from 'node:path';

import { extractRuntimeArchive } from '@xopcai/xopc/runtime-tools/archive.js';
import { downloadVerifiedArchive } from '@xopcai/xopc/runtime-tools/downloader.js';

import { managedFeishuSdkPath } from './lark-sdk.js';
import { FEISHU_SDK_PACKAGES } from './sdk-catalog.js';

const SDK_PACKAGE = '@larksuiteoapi/node-sdk';
let installation: Promise<void> | undefined;

function hasSdk(root: string): boolean {
  try {
    return statSync(join(root, 'node_modules', SDK_PACKAGE, 'package.json')).isFile();
  } catch {
    return false;
  }
}

/** Install the exact SDK and runtime dependencies without invoking package scripts. */
export function installFeishuSdk(): Promise<void> {
  installation ??= install().finally(() => { installation = undefined; });
  return installation;
}

async function install(): Promise<void> {
  const target = managedFeishuSdkPath();
  if (hasSdk(target)) return;
  const parent = join(target, '..');
  await mkdir(parent, { recursive: true, mode: 0o700 });
  const work = await mkdtemp(join(parent, '.install-'));
  const staged = join(work, 'sdk');
  try {
    for (let index = 0; index < FEISHU_SDK_PACKAGES.length; index += 6) {
      const results = await Promise.allSettled(FEISHU_SDK_PACKAGES.slice(index, index + 6).map(async ([name, packageVersion, bytes, sha256]) => {
        const basename = name.split('/').at(-1)!;
        const filename = `${basename}-${packageVersion}.tgz`;
        const archive = await downloadVerifiedArchive({
          runtime: 'feishu-sdk',
          url: `https://registry.npmjs.org/${name}/-/${filename}`,
          targetPath: join(work, `${sha256}.tgz.partial`),
          expectedBytes: bytes,
          expectedSha256: sha256,
          timeoutMs: 30_000,
        });
        const extracted = await extractRuntimeArchive({
          runtime: 'feishu-sdk',
          archivePath: archive,
          archiveType: 'tar.gz',
          stagingDir: join(work, sha256),
        });
        if (name === SDK_PACKAGE) {
          // The managed runtime uses the SDK's CommonJS entry.
          await Promise.all(['es', 'types'].map(directory => rm(join(extracted, directory), { recursive: true, force: true })));
        }
        const parts = name.split('/');
        await mkdir(join(staged, 'node_modules', ...parts.slice(0, -1)), { recursive: true });
        await rename(extracted, join(staged, 'node_modules', ...parts));
      }));
      const failed = results.find(result => result.status === 'rejected');
      if (failed) throw failed.reason;
    }
    const sdk = createRequire(join(staged, 'package.json'))(SDK_PACKAGE) as { Client?: unknown; WSClient?: unknown };
    if (typeof sdk.Client !== 'function' || typeof sdk.WSClient !== 'function') throw new Error('Feishu SDK failed its load check');
    try {
      await rename(staged, target);
    } catch (err) {
      // Another Gateway process may have installed the same pinned version.
      if (!hasSdk(target)) throw err;
    }
  } finally {
    await rm(work, { recursive: true, force: true });
  }
}
