import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import {
  closeXopcDatabase,
  ensureSessionRecord,
  openXopcDatabase,
  patchSessionMetadata,
  resetXopcDatabaseSingletonForTest,
} from '../../storage/sqlite/index.js';
import { assembleOutcomeContext } from '../outcome-context-assembler.js';
import { OutcomeRepository } from '../outcome-repository.js';

describe('assembleOutcomeContext', () => {
  let stateDir: string;
  const sessionKey = 'agent:main:webchat:default:direct:context-allocation';

  beforeEach(() => {
    stateDir = mkdtempSync(join(tmpdir(), 'xopc-outcome-context-'));
    resetXopcDatabaseSingletonForTest();
    openXopcDatabase({ path: join(stateDir, 'xopc.db') });
    ensureSessionRecord(sessionKey, stateDir);
  });

  afterEach(() => {
    closeXopcDatabase();
    resetXopcDatabaseSingletonForTest();
    rmSync(stateDir, { recursive: true, force: true });
  });

  it('retrieves memory against the full high-risk outcome rather than only the latest message', () => {
    const outcome = new OutcomeRepository().create({
      objective: 'Publish the release',
      deliverables: ['Production release'],
      acceptanceCriteria: ['Production reports version 2.0.0'],
      constraints: ['Do not expose credentials'],
      approvalRequired: ['Production publish'],
      assumptions: ['Release branch is current'],
      risks: ['Production outage'],
      importance: 'critical',
    });
    patchSessionMetadata(sessionKey, { customData: { outcomeId: outcome.id } });

    const assembled = assembleOutcomeContext(sessionKey, '继续');

    expect(assembled.allocation).toMatchObject({ profile: 'critical', maxResults: 32, maxChars: 64_000 });
    expect(assembled.retrievalQuery).toContain('Publish the release');
    expect(assembled.retrievalQuery).toContain('Production reports version 2.0.0');
    expect(assembled.retrievalQuery).toContain('Do not expose credentials');
    expect(assembled.retrievalQuery).toContain('Production outage');
  });
});
