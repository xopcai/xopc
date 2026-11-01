import { spawnSync } from 'node:child_process';
import { existsSync, mkdirSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = fileURLToPath(new URL('..', import.meta.url));
if (process.platform !== 'darwin') {
  console.log('[desktop-workspace] Native workspace access is unavailable on this platform');
} else {
  const headerIndex = process.argv.indexOf('--headers');
  const headers = headerIndex < 0 ? resolve(dirname(process.execPath), '../include/node') : resolve(process.argv[headerIndex + 1]);
  if (!existsSync(join(headers, 'node_api.h'))) throw new Error('Node N-API headers are required; provide --headers <include/node>');
  const directory = join(root, 'dist/electron/native'); mkdirSync(directory, { recursive: true });
  const output = join(directory, 'desktop-workspace.node');
  const result = spawnSync('c++', ['-arch', 'x86_64', '-arch', 'arm64', '-std=c++17', '-O2', '-DNAPI_VERSION=8', '-bundle', '-undefined', 'dynamic_lookup', '-I', headers,
    join(root, 'electron/native/desktop-workspace-macos.cc'), '-o', output], { stdio: 'inherit' });
  if (result.status !== 0) throw new Error('Native desktop workspace build failed');
  console.log('[desktop-workspace] Built ' + output);
}
