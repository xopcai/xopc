import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';

import { describe, expect, it } from 'vitest';

import { detectMigrations } from '../runner.js';
import { registerMigration, unregisterMigrationsForSource } from '../registry.js';
import type { Migration } from '../types.js';

describe('registered migrations', () => {
  it('includes extension-registered migrations in detection', () => {
    const dir = mkdtempSync(join(tmpdir(), 'xopc-registered-migration-test-'));
    const source = `test:${Date.now()}`;
    try {
      const configPath = join(dir, 'xopc.json');
      writeFileSync(configPath, '{}', 'utf8');
      const migration: Migration = {
        id: 'test-registered-migration',
        kind: 'state',
        safety: 'manual',
        detect: () => ({
          id: 'test-registered-migration',
          title: 'Test registered migration',
          kind: 'state',
          safety: 'manual',
          status: 'planned',
          message: 'Registered migration is visible.',
        }),
        apply: () => ({
          id: 'test-registered-migration',
          title: 'Test registered migration',
          kind: 'state',
          safety: 'manual',
          status: 'applied',
          message: 'Applied.',
        }),
      };
      registerMigration(source, migration);
      expect(detectMigrations(configPath, { stateDir: dir }).some((item) => item.id === migration.id)).toBe(true);
    } finally {
      unregisterMigrationsForSource(source);
      rmSync(dir, { recursive: true, force: true });
    }
  });
});
