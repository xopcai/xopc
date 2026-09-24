import { chmodSync, existsSync, readdirSync, rmSync } from 'node:fs';
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
  let releaseHelperRequired = false;
  if (target.platform === 'darwin') {
    const prebuiltHelper = join(prebuildDir, 'spawn-helper');
    releaseHelperRequired = !existsSync(prebuiltHelper);
    const helper = releaseHelperRequired ? join(releaseDir, 'spawn-helper') : prebuiltHelper;
    if (!existsSync(helper)) throw new Error('node-pty spawn-helper is missing');
    chmodSync(helper, 0o755);
  }

  const targetPrebuildExists = existsSync(prebuildDir);
  const releaseFallbackRequired =
    nativeNames.some((name) => existsSync(join(releaseDir, name))) &&
    !nativeNames.some((name) => existsSync(join(prebuildDir, name)));
  const keepRelease = releaseFallbackRequired || releaseHelperRequired;

  const prebuildsDir = join(packageDir, 'prebuilds');
  if (existsSync(prebuildsDir)) {
    for (const entry of readdirSync(prebuildsDir)) {
      if (entry !== `${target.platform}-${target.arch}`) {
        rmSync(join(prebuildsDir, entry), { recursive: true, force: true });
      }
    }
  }

  const keep = new Set(['LICENSE', 'lib', 'package.json']);
  if (targetPrebuildExists) keep.add('prebuilds');
  if (keepRelease) keep.add('build');
  for (const entry of readdirSync(packageDir)) {
    if (!keep.has(entry)) rmSync(join(packageDir, entry), { recursive: true, force: true });
  }

  // Debug symbols are useful to package authors, but not required to load the
  // production native modules. Windows prebuilds otherwise add tens of MiB.
  const runtimeDir = releaseFallbackRequired ? releaseDir : prebuildDir;
  if (existsSync(runtimeDir)) {
    for (const entry of readdirSync(runtimeDir, { withFileTypes: true })) {
      if (entry.isFile() && entry.name.endsWith('.pdb')) {
        rmSync(join(runtimeDir, entry.name), { force: true });
      }
    }
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
