import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import {
  closeXopcDatabase,
  ensureSessionRecord,
  openXopcDatabase,
  resetXopcDatabaseSingletonForTest,
  updateRelationshipSettings,
} from '../../storage/sqlite/index.js';
import { ContextCompiler } from '../context-compiler.js';

describe('ContextCompiler', () => {
  let stateDir: string;

  beforeEach(() => {
    stateDir = mkdtempSync(join(tmpdir(), 'xopc-context-compiler-'));
    resetXopcDatabaseSingletonForTest();
    openXopcDatabase({ path: join(stateDir, 'xopc.db') });
    ensureSessionRecord('agent:main:webchat:default:direct:context-test', stateDir);
  });

  afterEach(() => {
    closeXopcDatabase();
    resetXopcDatabaseSingletonForTest();
    rmSync(stateDir, { recursive: true, force: true });
  });

  it('freezes selected context, exclusions, and relationship policy for audit', () => {
    updateRelationshipSettings({ supportMode: 'coach', proactiveEnabled: true });
    const compiler = new ContextCompiler();
    const snapshot = compiler.capture({
      sessionKey: 'agent:main:webchat:default:direct:context-test',
      query: 'Prepare my launch decision.',
      now: 100,
      plan: {
        traceId: 'trace-context-1',
        modelMessage: { role: 'user', content: 'Prepare my launch decision.' },
        items: [{
          recordId: 'preference-1',
          content: 'Prefer a recommendation with a concise rationale.',
          score: 0.9,
          section: 'interaction',
          citation: 'user:preference-1',
          origin: 'told_by_user',
          stability: 0.95,
        }],
        rejected: [{ recordId: 'secret-1', reason: 'sensitive' }],
        consentRequests: [],
        estimatedTokens: 24,
      },
    });

    expect(snapshot).toMatchObject({
      traceId: 'trace-context-1',
      ownerKind: 'session',
      ownerId: 'agent:main:webchat:default:direct:context-test',
      estimatedTokens: 24,
      relationshipPolicy: { supportMode: 'coach', proactiveEnabled: true },
      selectedItems: [{ recordId: 'preference-1', origin: 'told_by_user' }],
      rejectedItems: [{ recordId: 'secret-1', reason: 'sensitive' }],
    });
    expect(compiler.latestForSession(snapshot.sessionKey!, 100)?.id).toBe(snapshot.id);
  });
});
