import { cpSync, mkdirSync, rmSync } from 'node:fs';
import { join } from 'node:path';

/** Ship the canonical fresh schema and the supported installed-database upgrade chain. */
export function copySqliteAssets(source, destination) {
  mkdirSync(destination, { recursive: true });
  cpSync(join(source, 'schema.sql'), join(destination, 'schema.sql'));
  rmSync(join(destination, 'migrations'), { recursive: true, force: true });
  rmSync(join(destination, 'upgrades'), { recursive: true, force: true });
  cpSync(join(source, 'upgrades'), join(destination, 'upgrades'), { recursive: true });
}
