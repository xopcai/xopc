// @vitest-environment jsdom
import { beforeEach, describe, expect, it } from 'vitest';

import {
  COMPOSER_INPUT_HISTORY_MAX,
  COMPOSER_INPUT_HISTORY_MAX_SESSIONS,
  COMPOSER_INPUT_HISTORY_STORAGE_KEY,
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

  it('stores all sessions under one aggregate key', () => {
    recordComposerInputHistory('session-a', 'a');
    recordComposerInputHistory('session-b', 'b');

    expect(getComposerInputHistory('session-a')).toEqual(['a']);
    expect(getComposerInputHistory('session-b')).toEqual(['b']);
    expect(localStorage.getItem(COMPOSER_INPUT_HISTORY_STORAGE_KEY)).toBeTruthy();
    expect([...Array.from({ length: localStorage.length }, (_, i) => localStorage.key(i))]).toEqual([
      COMPOSER_INPUT_HISTORY_STORAGE_KEY,
    ]);
  });

  it('migrates legacy per-session keys into the aggregate key', () => {
    localStorage.setItem('xopc.composer.inputHistory:legacy-session', JSON.stringify(['old', 'older']));

    expect(getComposerInputHistory('legacy-session')).toEqual(['old', 'older']);
    expect(localStorage.getItem('xopc.composer.inputHistory:legacy-session')).toBeNull();
    expect(localStorage.getItem(COMPOSER_INPUT_HISTORY_STORAGE_KEY)).toBeTruthy();
  });

  it(`caps aggregate storage at ${COMPOSER_INPUT_HISTORY_MAX_SESSIONS} sessions`, () => {
    for (let i = 0; i < COMPOSER_INPUT_HISTORY_MAX_SESSIONS + 5; i++) {
      recordComposerInputHistory(`session-${i}`, `m${i}`);
    }

    const raw = localStorage.getItem(COMPOSER_INPUT_HISTORY_STORAGE_KEY);
    expect(raw).toBeTruthy();
    const parsed = JSON.parse(raw ?? '{}') as { sessions?: Record<string, unknown> };
    expect(Object.keys(parsed.sessions ?? {})).toHaveLength(COMPOSER_INPUT_HISTORY_MAX_SESSIONS);
    expect(getComposerInputHistory('session-0')).toEqual([]);
    expect(getComposerInputHistory(`session-${COMPOSER_INPUT_HISTORY_MAX_SESSIONS + 4}`)).toEqual([
      `m${COMPOSER_INPUT_HISTORY_MAX_SESSIONS + 4}`,
    ]);
  });
});
