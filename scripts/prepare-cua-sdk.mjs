import { spawnSync } from 'node:child_process';
import { chmodSync, mkdtempSync, readFileSync, renameSync, rmSync, statSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { join } from 'node:path';
import { COMPUTER_DRIVER_VERSION, WINDOWS_COMPUTER_DRIVER_FILES } from './lib/computer-driver-release.mjs';

export const CUA_MAC_NATIVE_FILES = ['libcua_driver_sdk.dylib', 'cua_driver_node_runtime.node'];

/** Keep only the target Mach-O slice in the isolated macOS packaging tree. */
export function prepareCuaSdkRuntime(packDir, target, runLipo = spawnSync) {
  if (target.platform === 'win32') {
    if (target.arch !== 'x64') throw new Error(`Unsupported Windows CUA SDK architecture: ${target.arch}`);
    const packageDir = join(packDir, 'node_modules', '@trycua', 'cua-driver-win32-x64-msvc');
    const metadata = JSON.parse(readFileSync(join(packageDir, 'package.json'), 'utf8'));
    if (metadata.version !== COMPUTER_DRIVER_VERSION) throw new Error('Windows CUA SDK version mismatch');
    for (const name of ['cua_driver_sdk.dll', 'cua_driver_node_runtime.node']) {
      if (createHash('sha256').update(readFileSync(join(packageDir, name))).digest('hex') !== WINDOWS_COMPUTER_DRIVER_FILES[name]) {
        throw new Error(`Windows CUA SDK checksum mismatch: ${name}`);
      }
    }
    return;
  }
  if (target.platform !== 'darwin') return;
  const slice = target.arch === 'x64' ? 'x86_64' : target.arch;
  if (slice !== 'arm64' && slice !== 'x86_64') {
    throw new Error(`Unsupported macOS CUA SDK architecture: ${target.arch}`);
  }
  const packageDir = join(packDir, 'node_modules', '@trycua', `cua-driver-darwin-${target.arch}`);
  for (const name of CUA_MAC_NATIVE_FILES) {
    const source = join(packageDir, name);
    const mode = statSync(source).mode & 0o777;
    const inspected = runLipo('lipo', ['-archs', source], { encoding: 'utf8' });
    if (inspected.status !== 0) {
      throw new Error(`Cannot inspect CUA SDK ${name}: ${inspected.error?.message ?? inspected.stderr?.trim() ?? 'lipo failed'}`);
    }
    const architectures = inspected.stdout.trim().split(/\s+/);
    if (!architectures.includes(slice)) throw new Error(`CUA SDK ${name} is missing the ${slice} slice`);
    if (architectures.length === 1) continue;
    const temp = mkdtempSync(join(packageDir, '.thin-'));
    try {
      const destination = join(temp, name);
      const result = runLipo('lipo', [source, '-thin', slice, '-output', destination], { encoding: 'utf8' });
      if (result.status !== 0) {
        throw new Error(`Cannot thin CUA SDK ${name}: ${result.error?.message ?? result.stderr?.trim() ?? 'lipo failed'}`);
      }
      chmodSync(destination, mode);
      // Replace the staged inode instead of modifying pnpm's hard-linked store.
      renameSync(destination, source);
    } finally {
      rmSync(temp, { recursive: true, force: true });
    }
  }
}
