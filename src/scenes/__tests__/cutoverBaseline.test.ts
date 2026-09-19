import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { describe, expect, it } from 'vitest';

import { closeXopcDatabase, openXopcDatabase, resetXopcDatabaseSingletonForTest } from '../../storage/sqlite/index.js';
import { getSqliteDatabase } from '../../storage/sqlite/transaction.js';
import { inspectSceneCutover } from '../cutoverPreflight.js';

describe('scene cutover baseline coverage', () => {
  it('classifies every current production proactive and assistant heartbeat table', () => {
    const directory = mkdtempSync(join(tmpdir(), 'xopc-scene-cutover-'));
    resetXopcDatabaseSingletonForTest();
    try {
      openXopcDatabase({ path: join(directory, 'xopc.db') });
      const report = inspectSceneCutover(getSqliteDatabase());
      expect(report.tables.length).toBeGreaterThan(30);
      expect(report.tables.some((table) => table.name === 'heartbeat_checks')).toBe(true);
      expect(report.blockers).toEqual([]);
      expect(report.tables.filter((table) => table.destination === 'unmapped')).toEqual([]);
    } finally {
      closeXopcDatabase();
      resetXopcDatabaseSingletonForTest();
      rmSync(directory, { recursive: true, force: true });
    }
  });
});
