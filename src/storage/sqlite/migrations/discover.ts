import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';

import type { SqlMigration } from './types.js';

/** Matches `002_add_notes_index.sql` → target version 2. */
const MIGRATION_FILENAME = /^(\d{3})_[\w-]+\.sql$/;

export function discoverSqlMigrations(migrationsDir: string): SqlMigration[] {
  if (!existsSync(migrationsDir)) {
    return [];
  }

  const migrations: SqlMigration[] = [];
  for (const entry of readdirSync(migrationsDir, { withFileTypes: true })) {
    if (!entry.isFile()) continue;
    const match = MIGRATION_FILENAME.exec(entry.name);
    if (!match) continue;
    const targetVersion = Number.parseInt(match[1]!, 10);
    if (!Number.isInteger(targetVersion) || targetVersion < 2) {
      throw new Error(
        `Invalid SQLite migration filename "${entry.name}" (target version must be >= 2)`,
      );
    }
    migrations.push({
      targetVersion,
      filename: entry.name,
      sql: readFileSync(join(migrationsDir, entry.name), 'utf8'),
    });
  }

  migrations.sort((a, b) => a.targetVersion - b.targetVersion);
  validateMigrationSequence(migrations);
  return migrations;
}

export function validateMigrationSequence(migrations: SqlMigration[]): void {
  for (let index = 0; index < migrations.length; index++) {
    const expected = index + 2;
    const actual = migrations[index]!.targetVersion;
    if (actual !== expected) {
      throw new Error(
        `SQLite migration sequence gap: expected migration to version ${expected}, ` +
          `found ${migrations[index]!.filename} (v${actual})`,
      );
    }
  }
}

export function listRegisteredMigrationTargets(migrationsDir: string): number[] {
  return discoverSqlMigrations(migrationsDir).map((migration) => migration.targetVersion);
}
