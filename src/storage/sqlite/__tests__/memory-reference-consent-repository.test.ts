import { mkdtempSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';

import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import {
  closeXopcDatabase,
  consumeMemoryReferenceConsent,
  decideMemoryReferenceConsent,
  ensureMemoryReferenceConsentRequest,
  listMemoryReferenceConsents,
  hasUnresolvedMemoryConflict,
  markMemoryRecordsConflicted,
  openXopcDatabase,
  resetXopcDatabaseSingletonForTest,
  revokeMemoryReferenceConsent,
  upsertMemoryRecord,
} from '../index.js';

describe('memory reference consent repository', () => {
  let stateDir: string;

  beforeEach(() => {
    stateDir = mkdtempSync(join(tmpdir(), 'xopc-memory-consent-'));
    resetXopcDatabaseSingletonForTest();
    openXopcDatabase({ path: join(stateDir, 'xopc.db') });
  });

  afterEach(() => {
    closeXopcDatabase();
    resetXopcDatabaseSingletonForTest();
    rmSync(stateDir, { recursive: true, force: true });
  });

  function createRecord(): string {
    return upsertMemoryRecord({
      providerId: 'local',
      kind: 'preference',
      sourceAgentId: 'main',
      content: 'Prefer concise answers.',
      disclosurePolicy: 'ask_before_reference',
    }).id;
  }

  it('deduplicates pending requests and consumes a one-shot grant', () => {
    const recordId = createRecord();
    const first = ensureMemoryReferenceConsentRequest({ recordId, sessionKey: 'session-1', purpose: 'draft' });
    const repeated = ensureMemoryReferenceConsentRequest({ recordId, sessionKey: 'session-1', purpose: 'draft again' });
    expect(repeated.id).toBe(first.id);

    expect(decideMemoryReferenceConsent(first.id, 'once')?.status).toBe('granted');
    expect(consumeMemoryReferenceConsent(recordId, 'session-1')).toBe(true);
    expect(consumeMemoryReferenceConsent(recordId, 'session-1')).toBe(false);
    expect(listMemoryReferenceConsents()[0]?.status).toBe('consumed');
  });

  it('limits session grants and shares an always grant', () => {
    const recordId = createRecord();
    const sessionGrant = ensureMemoryReferenceConsentRequest({ recordId, sessionKey: 'session-1', purpose: 'draft' });
    decideMemoryReferenceConsent(sessionGrant.id, 'session');
    expect(consumeMemoryReferenceConsent(recordId, 'session-1')).toBe(true);
    expect(consumeMemoryReferenceConsent(recordId, 'session-2')).toBe(false);

    const globalGrant = ensureMemoryReferenceConsentRequest({ recordId, sessionKey: 'session-2', purpose: 'review' });
    decideMemoryReferenceConsent(globalGrant.id, 'always');
    expect(consumeMemoryReferenceConsent(recordId, 'session-3')).toBe(true);
  });

  it('revokes an active grant without deleting its audit row', () => {
    const recordId = createRecord();
    const request = ensureMemoryReferenceConsentRequest({ recordId, sessionKey: 'session-1', purpose: 'draft' });
    decideMemoryReferenceConsent(request.id, 'always');

    expect(revokeMemoryReferenceConsent(request.id)).toMatchObject({ id: request.id, status: 'denied' });
    expect(consumeMemoryReferenceConsent(recordId, 'session-2')).toBe(false);
    expect(listMemoryReferenceConsents()).toContainEqual(expect.objectContaining({ id: request.id, status: 'denied' }));
  });

  it('marks multiple current understandings as an unresolved conflict', () => {
    const first = createRecord();
    const second = upsertMemoryRecord({
      providerId: 'local',
      kind: 'preference',
      sourceAgentId: 'main',
      content: 'Prefer detailed answers.',
      status: 'active',
    }).id;
    expect(markMemoryRecordsConflicted([first, second], 'conflict-1')).toBe(2);
    expect(hasUnresolvedMemoryConflict('conflict-1')).toBe(true);
  });
});
