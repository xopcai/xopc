import type { Migration } from './types.js';

export type RegisteredMigration = {
  source: string;
  migration: Migration;
};

const registeredMigrations = new Map<string, RegisteredMigration>();

export function registerMigration(source: string, migration: Migration): void {
  registeredMigrations.set(`${source}:${migration.id}`, { source, migration });
}

export function unregisterMigrationsForSource(source: string): void {
  for (const [key, value] of registeredMigrations.entries()) {
    if (value.source === source) registeredMigrations.delete(key);
  }
}

export function listRegisteredMigrations(): RegisteredMigration[] {
  return [...registeredMigrations.values()];
}
