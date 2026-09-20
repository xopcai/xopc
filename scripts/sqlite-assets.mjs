import { cpSync, mkdirSync, readdirSync, rmSync } from 'node:fs';
import { join } from 'node:path';

function copySqlTree(source, destination) {
  for (const entry of readdirSync(source, { withFileTypes: true })) {
    if (entry.isDirectory()) copySqlTree(join(source, entry.name), join(destination, entry.name));
    else if (entry.isFile() && entry.name.endsWith('.sql')) {
      mkdirSync(destination, { recursive: true });
      cpSync(join(source, entry.name), join(destination, entry.name));
    }
  }
}

/** Copy the SQL tree from the same checkout as the compiled runtime. */
export function copySqliteAssets(source, destination, { clean = false } = {}) {
  mkdirSync(destination, { recursive: true });
  cpSync(join(source, 'schema.sql'), join(destination, 'schema.sql'));
  // Only Electron's asset-only directory may be cleaned: dist also contains JS.
  for (const directory of ['migrations', 'schemas']) {
    if (clean) rmSync(join(destination, directory), { recursive: true, force: true });
    copySqlTree(join(source, directory), join(destination, directory));
  }
}
