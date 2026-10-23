import { cpSync, mkdirSync, rmSync } from 'node:fs';
import { join } from 'node:path';

/** Copy the current schema and discard the retired upgrade tree. */
export function copySqliteAssets(source, destination) {
  mkdirSync(destination, { recursive: true });
  cpSync(join(source, 'schema.sql'), join(destination, 'schema.sql'));
  rmSync(join(destination, 'migrations'), { recursive: true, force: true });
}
