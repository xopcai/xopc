import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

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

describe('composer input history repository', () => {
  let stateDir: string;

  beforeEach(() => {
    stateDir = mkdtempSync(join(tmpdir(), 'xopc-composer-history-'));
    resetXopcDatabaseSingletonForTest();
    openXopcDatabase({ path: join(stateDir, 'xopc.db') });
  });

  afterEach(() => {
    closeXopcDatabase();
    resetXopcDatabaseSingletonForTest();
    rmSync(stateDir, { recursive: true, force: true });
  });

  it('stores one global newest-first list and deduplicates the head', () => {
    appendComposerInputHistory(' a ', 1);
    appendComposerInputHistory('b', 2);
    appendComposerInputHistory('b', 3);
    appendComposerInputHistory('a', 4);

    expect(listComposerInputHistory().map((item) => item.text)).toEqual(['a', 'b', 'a']);
  });

  it(`retains only ${COMPOSER_INPUT_HISTORY_LIMIT} entries`, () => {
    for (let i = 0; i < COMPOSER_INPUT_HISTORY_LIMIT + 5; i++) {
      appendComposerInputHistory(`message-${i}`, i);
    }
    const history = listComposerInputHistory();
    expect(history).toHaveLength(COMPOSER_INPUT_HISTORY_LIMIT);
    expect(history[0]?.text).toBe(`message-${COMPOSER_INPUT_HISTORY_LIMIT + 4}`);
    expect(history.at(-1)?.text).toBe('message-5');
  });

  it('clears all entries', () => {
    appendComposerInputHistory('a');
    expect(clearComposerInputHistory()).toBe(1);
    expect(listComposerInputHistory()).toEqual([]);
  });
});
