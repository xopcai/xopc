// @vitest-environment jsdom
import { beforeEach, describe, expect, it } from 'vitest';

import {
  COMPOSER_INPUT_HISTORY_MAX,
  getComposerInputHistory,
  recordComposerInputHistory,
} from '@/features/chat/composer/composer-input-history';

const SK = 'test-session-key';

beforeEach(() => {
  localStorage.clear();
});

describe('composer-input-history', () => {
  it('records newest first', () => {
    recordComposerInputHistory(SK, 'a');
    recordComposerInputHistory(SK, 'b');
    expect(getComposerInputHistory(SK)).toEqual(['b', 'a']);
  });

  it('does not duplicate when same as list head', () => {
    recordComposerInputHistory(SK, 'x');
    recordComposerInputHistory(SK, 'x');
    expect(getComposerInputHistory(SK)).toEqual(['x']);
  });

  it('allows repeating an older line after a different line', () => {
    recordComposerInputHistory(SK, 'a');
    recordComposerInputHistory(SK, 'b');
    recordComposerInputHistory(SK, 'a');
    expect(getComposerInputHistory(SK)).toEqual(['a', 'b', 'a']);
  });

  it(`caps at ${COMPOSER_INPUT_HISTORY_MAX} entries`, () => {
    for (let i = 0; i < 25; i++) {
      recordComposerInputHistory(SK, `m${i}`);
    }
    const list = getComposerInputHistory(SK);
    expect(list.length).toBe(COMPOSER_INPUT_HISTORY_MAX);
    expect(list[0]).toBe('m24');
  });

  it('no-ops without sessionKey', () => {
    recordComposerInputHistory(null, 'hi');
    expect(getComposerInputHistory(null)).toEqual([]);
  });

  it('skips whitespace-only text', () => {
    recordComposerInputHistory(SK, '   ');
    expect(getComposerInputHistory(SK)).toEqual([]);
  });

  it('stores trimmed text', () => {
    recordComposerInputHistory(SK, '  hello  ');
    expect(getComposerInputHistory(SK)).toEqual(['hello']);
  });

  it('returns empty array for corrupt JSON', () => {
    localStorage.setItem('xopc.composer.inputHistory:test-corrupt', '{not-json');
    expect(getComposerInputHistory('test-corrupt')).toEqual([]);
  });
});
