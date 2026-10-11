import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { closeXopcDatabase, requireXopcDatabase } from '../../../storage/sqlite/connection.js';
import { getSqliteDatabase } from '../../../storage/sqlite/transaction.js';
import { claimOpeningGreeting, finishOpeningGreeting, openingGreetingText } from '../opening-greeting.js';

describe('Opening greeting identity and delivery', () => {
  let directory: string;
  let previous: string | undefined;
  const identity = { principalId: 'owner', conversationId: 'personal', logicalCallId: 'call', responseId: 'greeting' };
  beforeEach(() => {
    closeXopcDatabase();
    previous = process.env.XOPC_STATE_DIR;
    directory = mkdtempSync(join(tmpdir(), 'xopc-opening-'));
    process.env.XOPC_STATE_DIR = directory;
    requireXopcDatabase();
  });
  afterEach(() => {
    closeXopcDatabase();
    if (previous === undefined) delete process.env.XOPC_STATE_DIR;
    else process.env.XOPC_STATE_DIR = previous;
    rmSync(directory, { recursive: true, force: true });
  });
  it('addresses the confirmed user name with safe language fallbacks', () => {
    expect(openingGreetingText('小明', 'zh')).toBe('嗨，小明，我在。');
    expect(openingGreetingText(' Joy\n', 'en')).toBe("Hi, Joy. I'm here.");
    expect(openingGreetingText(null, 'zh')).toBe('嗨，我在。');
    expect(openingGreetingText('', 'en')).toBe("Hi, I'm here.");
  });
  it('claims once across reconnections and database reopen, including failed playback', () => {
    expect(claimOpeningGreeting(identity)).toBe(true);
    finishOpeningGreeting(identity, 'failed');
    closeXopcDatabase(); requireXopcDatabase();
    expect(claimOpeningGreeting({ ...identity, responseId: 'new-response' })).toBe(false);
    expect(claimOpeningGreeting({ ...identity, logicalCallId: 'new-call' })).toBe(true);
  });
  it('retains terminal state and cleans only old call records', () => {
    expect(claimOpeningGreeting(identity, Date.now() - 86_400_001)).toBe(true);
    expect(claimOpeningGreeting({ ...identity, logicalCallId: 'current' })).toBe(true);
    expect(getSqliteDatabase().prepare('SELECT COUNT(*) AS count FROM voice_opening_greetings').get()?.count).toBe(1);
    const current = { ...identity, logicalCallId: 'current' };
    finishOpeningGreeting(current, 'interrupted');
    finishOpeningGreeting(current, 'completed');
    expect(getSqliteDatabase().prepare('SELECT state FROM voice_opening_greetings').get()?.state).toBe('interrupted');
  });
});
