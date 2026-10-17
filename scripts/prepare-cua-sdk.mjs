import { spawnSync } from 'node:child_process';
import { chmodSync, mkdtempSync, renameSync, rmSync, statSync } from 'node:fs';
import { join } from 'node:path';

export const CUA_MAC_NATIVE_FILES = ['libcua_driver_sdk.dylib', 'cua_driver_node_runtime.node'];

/** Keep only the target Mach-O slice in the isolated macOS packaging tree. */
export function prepareCuaSdkRuntime(packDir, target, runLipo = spawnSync) {
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
