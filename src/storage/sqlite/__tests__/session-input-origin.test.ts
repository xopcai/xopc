import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import {
  closeXopcDatabase,
  findSessionInput,
  insertSessionInput,
  openXopcDatabase,
  resetXopcDatabaseSingletonForTest,
} from '../index.js';

describe('session input origin', () => {
  let stateDir: string;

  beforeEach(() => {
    stateDir = mkdtempSync(join(tmpdir(), 'xopc-session-origin-'));
    resetXopcDatabaseSingletonForTest();
    openXopcDatabase({ path: join(stateDir, 'xopc.db') });
  });

  afterEach(() => {
    closeXopcDatabase();
    resetXopcDatabaseSingletonForTest();
    rmSync(stateDir, { recursive: true, force: true });
  });

  it('persists the exact endpoint that submitted a queued turn', () => {
    const inserted = insertSessionInput({
      id: 'input-1',
      sessionKey: 'agent:main:webchat:default:direct:user',
      clientMessageId: 'message-1',
      requestedDelivery: 'next',
      effectiveDelivery: 'next',
      status: 'queued',
      content: 'hello',
      origin: { type: 'endpoint', endpointId: 'tab-1' },
    });

    expect(inserted.origin).toEqual({ type: 'endpoint', endpointId: 'tab-1' });
    expect(findSessionInput(inserted.sessionKey, inserted.clientMessageId)?.origin).toEqual({
      type: 'endpoint',
      endpointId: 'tab-1',
    });
  });
});
