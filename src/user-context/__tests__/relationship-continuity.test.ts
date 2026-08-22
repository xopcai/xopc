import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import {
  closeXopcDatabase, listUnderstandingEvidence, openXopcDatabase,
  resetXopcDatabaseSingletonForTest,
} from '../../storage/sqlite/index.js';
import {
  extractExplicitRelationshipFollowUp,
  recordExplicitRelationshipFollowUp,
} from '../relationship-continuity.js';

describe('relationship continuity', () => {
  let stateDir: string;

  beforeEach(() => {
    stateDir = mkdtempSync(join(tmpdir(), 'xopc-relationship-continuity-'));
    resetXopcDatabaseSingletonForTest();
    openXopcDatabase({ path: join(stateDir, 'xopc.db') });
  });

  afterEach(() => {
    closeXopcDatabase();
    resetXopcDatabaseSingletonForTest();
    rmSync(stateDir, { recursive: true, force: true });
  });

  it('only extracts explicit follow-up requests', () => {
    expect(extractExplicitRelationshipFollowUp('我明天要去面试')).toBeNull();
    expect(extractExplicitRelationshipFollowUp('明天问问我面试怎么样', 0)).toEqual({
      subject: '面试怎么样', validFrom: 86_400_000,
    });
    expect(extractExplicitRelationshipFollowUp('跟进的线索。')).toBeNull();
  });

  it('stores explicit follow-up in structured user understanding with evidence', () => {
    const understanding = recordExplicitRelationshipFollowUp({
      sessionKey: 'session-1', message: '明天问问我面试怎么样', nowMs: 0,
    });
    expect(understanding).toMatchObject({
      kind: 'relationship', status: 'active', explicitness: 'explicit',
      statement: '面试怎么样', validFrom: 86_400_000,
    });
    expect(listUnderstandingEvidence(understanding!.id)).toEqual([
      expect.objectContaining({ sourceType: 'conversation', trustLevel: 'owner' }),
    ]);
  });
});
