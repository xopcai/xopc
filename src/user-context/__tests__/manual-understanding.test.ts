import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import {
  closeXopcDatabase,
  openXopcDatabase,
  resetXopcDatabaseSingletonForTest,
} from '../../storage/sqlite/index.js';
import { createManualUnderstanding } from '../manual-understanding.js';

describe('manual user understanding', () => {
  let stateDir: string;

  beforeEach(() => {
    stateDir = mkdtempSync(join(tmpdir(), 'xopc-manual-understanding-'));
    resetXopcDatabaseSingletonForTest();
    openXopcDatabase({ path: join(stateDir, 'xopc.db') });
  });

  afterEach(() => {
    closeXopcDatabase();
    resetXopcDatabaseSingletonForTest();
    rmSync(stateDir, { recursive: true, force: true });
  });

  const create = (scope: { type: 'global' } | { type: 'session'; sessionKey: string }) => (
    createManualUnderstanding({
      agentId: 'main',
      content: 'I prefer concise status updates.',
      kind: 'preference',
      scope,
      sensitivity: 'normal',
      durability: scope.type === 'session' ? 'ephemeral' : 'durable',
      disclosurePolicy: 'referenceable',
    })
  );

  it('deduplicates within a scope but not across scopes', () => {
    expect(create({ type: 'global' }).created).toBe(true);
    expect(create({ type: 'global' }).created).toBe(false);
    const session = create({ type: 'session', sessionKey: 'agent:main:webchat:dm:1' });
    expect(session.created).toBe(true);
    expect(session.record.scope.sessionKey).toBe('agent:main:webchat:dm:1');
  });
});
