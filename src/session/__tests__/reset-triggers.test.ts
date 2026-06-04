import { describe, expect, it, vi } from 'vitest';

import {
  DEFAULT_RESET_TRIGGERS,
  matchResetTriggers,
  resolveResetTriggers,
  shouldSkipResetOverlapCommand,
  stripLeadingEnvelopeTimestamp,
} from '../reset-triggers.js';

describe('matchResetTriggers', () => {
  it('matches bare /new case-insensitively', () => {
    const m = matchResetTriggers('/NEW', DEFAULT_RESET_TRIGGERS);
    expect(m).toMatchObject({
      resetTriggered: true,
      bodyStripped: '',
      bareReset: true,
    });
  });

  it('matches /reset with tail and preserves tail casing', () => {
    const m = matchResetTriggers('/reset Hello World', DEFAULT_RESET_TRIGGERS);
    expect(m).toMatchObject({
      resetTriggered: true,
      bodyStripped: 'Hello World',
      bareReset: false,
    });
  });

  it('strips envelope timestamp before matching', () => {
    const body = stripLeadingEnvelopeTimestamp('[Jun 4 17:35] /new');
    expect(body).toBe('/new');
    const m = matchResetTriggers('[Jun 4 17:35] /new', DEFAULT_RESET_TRIGGERS);
    expect(m.resetTriggered).toBe(true);
    expect(m.bareReset).toBe(true);
  });

  it('does not match partial triggers without space', () => {
    const m = matchResetTriggers('/newchat', DEFAULT_RESET_TRIGGERS);
    expect(m.resetTriggered).toBe(false);
  });

  it('uses custom triggers from config', () => {
    const m = matchResetTriggers('/fresh start', ['/fresh']);
    expect(m.resetTriggered).toBe(true);
    expect(m.bodyStripped).toBe('start');
  });
});

describe('resolveResetTriggers', () => {
  it('defaults when config empty', () => {
    expect(resolveResetTriggers(undefined)).toEqual(DEFAULT_RESET_TRIGGERS);
    expect(resolveResetTriggers([])).toEqual(DEFAULT_RESET_TRIGGERS);
  });

  it('uses configured list when non-empty', () => {
    expect(resolveResetTriggers(['/go'])).toEqual(['/go']);
  });
});

describe('shouldSkipResetOverlapCommand', () => {
  it('skips new/reset/restart when reset already triggered at init', () => {
    expect(shouldSkipResetOverlapCommand('new', true)).toBe(true);
    expect(shouldSkipResetOverlapCommand('reset', true)).toBe(true);
    expect(shouldSkipResetOverlapCommand('list', true)).toBe(false);
    expect(shouldSkipResetOverlapCommand('new', false)).toBe(false);
  });
});
