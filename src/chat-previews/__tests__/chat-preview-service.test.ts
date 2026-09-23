import { randomUUID } from 'node:crypto';

import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { createConversation } from '../../storage/sqlite/conversation-repository.js';
import {
  closeXopcDatabase,
  getSqliteDatabase,
  openXopcDatabase,
  resetXopcDatabaseSingletonForTest,
} from '../../storage/sqlite/index.js';
import {
  ChatPreviewRevisionConflictError,
  ChatPreviewService,
} from '../service.js';

describe('ChatPreviewService', () => {
  beforeEach(() => {
    resetXopcDatabaseSingletonForTest();
    openXopcDatabase({ path: ':memory:' });
  });

  afterEach(() => {
    closeXopcDatabase();
    resetXopcDatabaseSingletonForTest();
  });

  it('stores immutable revisions without creating a project', () => {
    const conversationId = createConversation({ agentId: 'main', sourceChannel: 'webchat' }).key;
    const service = new ChatPreviewService();
    const created = service.create(conversationId, {
      title: 'Login page',
      markup: '<main>Sign in</main>',
      styles: 'main { padding: 2rem; }',
      script: '',
      preferredHeight: 420,
    });

    expect(created.preview.conversationId).toBe(conversationId);
    expect(created.revision.sourceHash).toMatch(/^[a-f0-9]{64}$/);
    expect((getSqliteDatabase().prepare('SELECT count(*) AS count FROM projects').get() as { count: number }).count).toBe(0);

    const revised = service.revise(created.preview.id, {
      baseRevision: created.revision.sourceHash,
      markup: '<main>Welcome back</main>',
      styles: created.revision.styles,
      script: '',
    });
    expect(revised.revision.sourceHash).not.toBe(created.revision.sourceHash);
    expect(service.getRevision(created.preview.id, created.revision.sourceHash).markup).toContain('Sign in');
    expect(() => service.revise(created.preview.id, {
      baseRevision: created.revision.sourceHash,
      markup: '<main>Stale</main>',
      styles: '',
      script: '',
    })).toThrow(ChatPreviewRevisionConflictError);
  });

  it('rejects a preview for a missing conversation', () => {
    const service = new ChatPreviewService();
    expect(() => service.create(randomUUID(), {
      title: 'Detached', markup: '<main />', styles: '', script: '', preferredHeight: 480,
    })).toThrow();
  });
});
