import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { createConversation } from '../conversation-repository.js';
import { getSqliteDatabase } from '../transaction.js';

import {
  appendComposerInputHistory,
  clearComposerInputHistory,
  COMPOSER_INPUT_HISTORY_LIMIT,
  listComposerInputHistory,
} from '../composer-input-history-repository.js';
import {
  closeXopcDatabase,
  openXopcDatabase,
  resetXopcDatabaseSingletonForTest,
} from '../connection.js';

const A = '11111111-1111-4111-8111-111111111111';
const B = '22222222-2222-4222-8222-222222222222';

describe('composer input history repository', () => {
  let stateDir: string;

  beforeEach(() => {
    stateDir = mkdtempSync(join(tmpdir(), 'xopc-composer-history-'));
    resetXopcDatabaseSingletonForTest();
    openXopcDatabase({ path: join(stateDir, 'xopc.db') });
    createConversation({ agentId: 'main' }, '', A);
    createConversation({ agentId: 'main' }, '', B);
  });

  afterEach(() => {
    closeXopcDatabase();
    resetXopcDatabaseSingletonForTest();
    rmSync(stateDir, { recursive: true, force: true });
  });

  it('stores a session newest-first list and deduplicates the head', () => {
    appendComposerInputHistory(A, ' a ', 1);
    appendComposerInputHistory(A, 'b', 2);
    appendComposerInputHistory(A, 'b', 3);
    appendComposerInputHistory(A, 'a', 4);

    expect(listComposerInputHistory(A).map((item) => item.text)).toEqual(['a', 'b', 'a']);
  });

  it(`retains only ${COMPOSER_INPUT_HISTORY_LIMIT} entries`, () => {
    for (let i = 0; i < COMPOSER_INPUT_HISTORY_LIMIT + 5; i++) {
      appendComposerInputHistory(A, `message-${i}`, i);
    }
    const history = listComposerInputHistory(A);
    expect(history).toHaveLength(COMPOSER_INPUT_HISTORY_LIMIT);
    expect(history[0]?.text).toBe(`message-${COMPOSER_INPUT_HISTORY_LIMIT + 4}`);
    expect(history.at(-1)?.text).toBe('message-5');
  });

  it('isolates deduplication, retention, clearing, and deletion by conversation', () => {
    appendComposerInputHistory(B, 'same');
    appendComposerInputHistory(A, 'same');
    expect(listComposerInputHistory(B).map(item => item.text)).toEqual(['same']);
    for (let i = 0; i < 105; i++) appendComposerInputHistory(A, `a-${i}`);
    expect(listComposerInputHistory(A)).toHaveLength(100);
    expect(listComposerInputHistory(B)).toHaveLength(1);
    clearComposerInputHistory(A);
    expect(listComposerInputHistory(B)).toHaveLength(1);
    getSqliteDatabase().prepare('DELETE FROM sessions WHERE conversation_id = ?').run(B);
    expect(listComposerInputHistory(B)).toEqual([]);
  });



  it('clears session entries' , () => {
    appendComposerInputHistory(A, 'a');
    expect(clearComposerInputHistory(A)).toBe(1);
    expect(listComposerInputHistory(A)).toEqual([]);
  });
});
