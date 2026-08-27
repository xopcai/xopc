import { chmodSync, existsSync } from 'node:fs';
import { createRequire } from 'node:module';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

export function prepareNodePtyPackage(
  packageDir,
  target = { platform: process.platform, arch: process.arch },
) {
  const prebuildDir = join(packageDir, 'prebuilds', `${target.platform}-${target.arch}`);
  const releaseDir = join(packageDir, 'build', 'Release');
  const nativeNames = target.platform === 'win32' ? ['conpty.node', 'pty.node'] : ['pty.node'];
  const hasNativeModule = nativeNames.some((name) =>
    existsSync(join(prebuildDir, name)) || existsSync(join(releaseDir, name)),
  );
  if (!hasNativeModule) {
    throw new Error(`node-pty has no native module for ${target.platform}/${target.arch}`);
  }
  if (target.platform === 'darwin') {
    const helper = existsSync(join(prebuildDir, 'spawn-helper'))
      ? join(prebuildDir, 'spawn-helper')
      : join(releaseDir, 'spawn-helper');
    if (!existsSync(helper)) throw new Error('node-pty spawn-helper is missing');
    chmodSync(helper, 0o755);
  }
}

export function resolveNodePtyPackage(repoRoot) {
  const requireFromRoot = createRequire(join(repoRoot, 'package.json'));
  return dirname(requireFromRoot.resolve('node-pty/package.json'));
}

const directRun = process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1];
if (directRun) {
  const repoRoot = join(dirname(fileURLToPath(import.meta.url)), '..');
  prepareNodePtyPackage(resolveNodePtyPackage(repoRoot));
}
